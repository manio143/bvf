#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { parseBvfFile } from './parser.js';
import { resolveReferences } from './resolver.js';
import { loadConfig, defaultConfig } from './config.js';
import { 
  loadManifest, 
  saveManifest, 
  computeSpecHash, 
  computeDependencyHash,
  getEntityStatus,
  findOrphanedEntries 
} from './manifest.js';
import type { ResolvedEntity, Manifest, ManifestEntry } from './types.js';

const commands = ['resolve', 'list', 'init', 'mark'];

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || !commands.includes(command)) {
    console.error('Usage: bvf <command> [options]');
    console.error('Commands: resolve, list, init, mark');
    process.exit(1);
  }
  
  switch (command) {
    case 'resolve':
      await cmdResolve(args.slice(1));
      break;
    case 'list':
      await cmdList(args.slice(1));
      break;
    case 'init':
      await cmdInit();
      break;
    case 'mark':
      await cmdMark(args.slice(1));
      break;
  }
}

async function cmdResolve(cmdArgs: string[]) {
  const cwd = process.cwd();
  const showDiff = cmdArgs.includes('--diff');
  
  // Load config
  const configResult = loadConfig(cwd);
  if (!configResult.ok) {
    console.error('Error loading config:');
    for (const error of configResult.errors || []) {
      console.error(`  ${error.message}`);
    }
    process.exit(1);
  }
  
  const config = configResult.value!;
  
  // Find and parse all .bvf files
  const specsDir = join(cwd, 'specs');
  if (!existsSync(specsDir)) {
    console.error('Error: specs/ directory not found');
    process.exit(1);
  }
  
  const allEntities: any[] = [];
  const parseErrors: Error[] = [];
  
  const bvfFiles = findBvfFiles(specsDir, config.fileExtension);
  
  // Helper to recursively propagate sourceFile to all nested entities
  function propagateSourceFile(entity: any, file: string) {
    entity.sourceFile = file;
    if (entity.behaviors) {
      for (const child of entity.behaviors) {
        propagateSourceFile(child, file);
      }
    }
  }
  
  for (const file of bvfFiles) {
    const content = readFileSync(file, 'utf-8');
    const result = parseBvfFile(content, config);
    
    if (!result.ok) {
      parseErrors.push(...(result.errors || []));
      continue;
    }
    
    // Add source file to entities AND their children recursively
    for (const entity of result.value || []) {
      propagateSourceFile(entity, file);
    }
    
    allEntities.push(...(result.value || []));
  }
  
  if (parseErrors.length > 0) {
    for (const error of parseErrors) {
      console.error(`Parse error: ${error.message}`);
    }
    // Print summary even with parse errors
    console.log(`\nSummary:`);
    console.log(`  Errors: ${parseErrors.length}`);
    process.exit(1);
  }
  
  // Resolve references
  const resolveResult = resolveReferences(allEntities, config);
  
  let resolved = allEntities;
  let errorCount = 0;
  
  if (!resolveResult.ok) {
    errorCount = (resolveResult.errors || []).length;
    for (const error of resolveResult.errors || []) {
      console.error(`Resolution error: ${error.message}`);
    }
    // Continue to print summary
  } else {
    resolved = resolveResult.value!;
  }
  
  // Recursively flatten all entities (including deeply nested children)
  // IMPORTANT: Copy transitiveDependencies from parent to child behaviors
  // Note: Resolver already flattens behaviors to top-level, so we need to avoid duplicates
  function flattenEntities(entities: any[], depth: number = 0): any[] {
    const result: any[] = [];
    const seen = new Set<string>();
    
    for (const entity of entities) {
      // Add top-level entity if not seen
      if (!seen.has(entity.name)) {
        result.push(entity);
        seen.add(entity.name);
      }
      
      // Extract nested behaviors (if not already in top-level)
      if (entity.behaviors) {
        for (const behavior of entity.behaviors) {
          if (!seen.has(behavior.name)) {
            // Propagate transitiveDependencies from parent
            const enrichedBehavior = {
              ...behavior,
              type: 'behavior',
              transitiveDependencies: entity.transitiveDependencies || []
            };
            result.push(enrichedBehavior);
            seen.add(behavior.name);
          }
        }
      }
    }
    return result;
  }
  
  const allResolvedEntities = flattenEntities(resolved);
  
  // Load manifest
  const stateDir = join(cwd, config.stateDir);
  const manifest = loadManifest(stateDir);
  
  // Compute current hashes for all entities (including nested)
  const currentHashes = new Map<string, string>();
  for (const entity of allResolvedEntities) {
    currentHashes.set(entity.name, computeSpecHash(entity));
  }
  
  // Determine container and leaf types from config
  const parentTypes = new Set<string>();
  const childTypes = new Set<string>();
  
  if (config.containment) {
    for (const [parent, children] of config.containment) {
      parentTypes.add(parent);
      for (const child of children) {
        childTypes.add(child);
      }
    }
  }
  
  // Leaf types: appear only as children, never as parents
  const leafTypes = new Set([...childTypes].filter(t => !parentTypes.has(t)));
  
  // Standalone types: not mentioned in containment at all
  const allContainmentTypes = new Set([...parentTypes, ...childTypes]);
  const standaloneTypes = new Set(config.types.filter(t => !allContainmentTypes.has(t)));
  
  // Counted types: if config specifies materializable, use it; otherwise infer (leaf + standalone)
  let countedTypes: Set<string>;
  if (config.materializable && config.materializable.length > 0) {
    countedTypes = new Set(config.materializable);
  } else {
    // Infer: leaf types + standalone types (these are materializable)
    countedTypes = new Set([...leafTypes, ...standaloneTypes]);
  }
  
  // Build map of ALL children to their parents (recursively)
  const childToParent = new Map<string, string>();
  
  function mapChildrenToParent(entities: any[]) {
    for (const entity of entities) {
      if (parentTypes.has(entity.type) && entity.behaviors) {
        for (const child of entity.behaviors) {
          childToParent.set(child.name, entity.name);
          // Recursively process child's children
          if (child.behaviors) {
            mapChildrenToParent([child]);
          }
        }
      }
    }
  }
  
  mapChildrenToParent(resolved);
  
  // Check status of each entity
  let pendingCount = 0;
  let currentCount = 0;
  let staleCount = 0;
  
  // Build a map of statuses and track counted entities to avoid double-counting
  const entityStatuses = new Map<string, any>();
  const countedEntities = new Set<string>();
  
  // Auto-transition logic: detect staleness and update manifest
  let manifestUpdated = false;
  
  for (const entity of allResolvedEntities) {
    const entry = manifest.entries.get(entity.name);
    if (!entry) continue; // Skip entities not in manifest
    
    const currentSpecHash = computeSpecHash(entity);
    const currentDepHash = computeDependencyHash(entity, currentHashes);
    
    // Auto-transition 1: Elaboration completed → re-review
    if (entry.reason === 'needs-elaboration' && entry.specHash !== currentSpecHash) {
      entry.specHash = currentSpecHash;
      entry.dependencyHash = currentDepHash;
      entry.reason = 'needs-review';
      manifest.entries.set(entity.name, entry);
      manifestUpdated = true;
      continue; // Skip auto-transition 2 for this entity
    }
    
    // Auto-transition 2: Staleness detected → restart workflow
    // Only auto-transition if entity was previously "complete" (current + reviewed)
    // This prevents cascading resets for entities still in workflow
    const wasComplete = entry.status === 'current' && entry.reason === 'reviewed';
    const isStale = entry.specHash !== currentSpecHash || entry.dependencyHash !== currentDepHash;
    
    if (wasComplete && isStale) {
      entry.status = 'pending';
      entry.reason = 'needs-review';
      entry.specHash = currentSpecHash;
      entry.dependencyHash = currentDepHash;
      // Preserve artifact for context
      manifest.entries.set(entity.name, entry);
      manifestUpdated = true;
    }
  }
  
  // Write manifest if auto-transitions occurred
  if (manifestUpdated) {
    saveManifest(stateDir, manifest);
  }
  
  // Now compute statuses after auto-transitions
  for (const entity of allResolvedEntities) {
    const status = getEntityStatus(entity, manifest, currentHashes);
    entityStatuses.set(entity.name, status);
    
    // Only count materializable entities (leaf + standalone types) in summary
    // Use Set to prevent double-counting if entity appears multiple times
    if (countedTypes.has(entity.type) && !countedEntities.has(entity.name)) {
      countedEntities.add(entity.name);
      
      switch (status.status) {
        case 'pending':
          pendingCount++;
          break;
        case 'current':
          currentCount++;
          break;
        case 'stale':
          staleCount++;
          break;
      }
    }
  }
  
  // Group entities by containers (parent types in containment)
  const containers: Array<{ container: any | null; entities: any[]; hasIssues: boolean }> = [];
  const containerMap = new Map<string, any>();
  const standalone: any[] = [];
  
  for (const entity of resolved) {
    if (parentTypes.has(entity.type)) {
      containerMap.set(entity.name, entity);
    }
  }
  
  // Process containers first
  for (const [containerName, container] of containerMap) {
    const children = container.behaviors || [];
    let hasIssues = false;
    
    // Check if any of the container's children have issues
    // (The container entity itself is a container — its status doesn't
    // determine ordering. Only child statuses matter.)
    for (const child of children) {
      const childStatus = entityStatuses.get(child.name);
      if (childStatus && (childStatus.status === 'stale' || childStatus.status === 'pending')) {
        hasIssues = true;
        break;
      }
    }
    
    containers.push({ container, entities: [container, ...children], hasIssues });
  }
  
  // Collect standalone entities (not containers and not children of containers)
  for (const entity of resolved) {
    if (!parentTypes.has(entity.type) && !childToParent.has(entity.name)) {
      standalone.push(entity);
    }
  }
  
  // Check if standalone group has issues
  let standaloneHasIssues = false;
  for (const entity of standalone) {
    const status = entityStatuses.get(entity.name);
    if (status && (status.status === 'stale' || status.status === 'pending')) {
      standaloneHasIssues = true;
      break;
    }
  }
  
  // Sort containers: clean first (alphabetically), then problematic (alphabetically)
  const cleanContainers = containers.filter(c => !c.hasIssues).sort((a, b) => 
    (a.container?.name || '').localeCompare(b.container?.name || '')
  );
  const problematicContainers = containers.filter(c => c.hasIssues).sort((a, b) => 
    (a.container?.name || '').localeCompare(b.container?.name || '')
  );
  
  console.log('Resolution Status:\n');
  
  // Print clean containers first
  for (const { container, entities } of cleanContainers) {
    printContainerGroup(container, entities, entityStatuses, manifest, showDiff, countedTypes);
  }
  
  // Print standalone entities (if they're clean, before problematic containers)
  if (standalone.length > 0 && !standaloneHasIssues) {
    for (const entity of standalone) {
      printEntity(entity, entityStatuses.get(entity.name), manifest, showDiff, 0, countedTypes);
    }
    console.log('');
  }
  
  // Print problematic containers
  for (const { container, entities } of problematicContainers) {
    printContainerGroup(container, entities, entityStatuses, manifest, showDiff, countedTypes);
  }
  
  // Print standalone entities if they have issues (at the end)
  if (standalone.length > 0 && standaloneHasIssues) {
    for (const entity of standalone) {
      printEntity(entity, entityStatuses.get(entity.name), manifest, showDiff, 0, countedTypes);
    }
    console.log('');
  }
  
  // Check for orphaned entries
  const orphaned = findOrphanedEntries(manifest, allResolvedEntities);
  
  if (orphaned.length > 0) {
    console.log('Orphaned (removed from specs):');
    for (const name of orphaned) {
      console.log(`  ${name}`);
    }
    console.log('');
  }
  
  console.log(`Summary:`);
  console.log(`  Current: ${currentCount}`);
  console.log(`  Pending: ${pendingCount}`);
  console.log(`  Stale: ${staleCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Total: ${currentCount + pendingCount + staleCount}`);
  
  if (staleCount > 0 || pendingCount > 0) {
    console.log('\nRun materialization to generate/update test files.');
  }
  
  // Save manifest (ensures it exists and reflects current state)
  saveManifest(stateDir, manifest);
  
  if (errorCount > 0) {
    process.exit(1);
  }
}

function printContainerGroup(container: any, entities: any[], statuses: Map<string, any>, manifest: any, showDiff: boolean, countedTypes: Set<string>) {
  // Print container itself
  const containerStatus = statuses.get(container.name);
  if (containerStatus) {
    printEntity(container, containerStatus, manifest, showDiff, 0, countedTypes);
  }
  
  // Print children nested under container recursively
  printChildrenRecursive(container.behaviors || [], statuses, manifest, showDiff, 2, countedTypes);
  
  console.log('');
}

function printChildrenRecursive(children: any[], statuses: Map<string, any>, manifest: any, showDiff: boolean, indent: number, countedTypes: Set<string>) {
  for (const child of children) {
    const status = statuses.get(child.name);
    if (status) {
      printEntity(child, status, manifest, showDiff, indent, countedTypes);
    }
    // Recursively print this child's children with increased indent
    if (child.behaviors && child.behaviors.length > 0) {
      printChildrenRecursive(child.behaviors, statuses, manifest, showDiff, indent + 2, countedTypes);
    }
  }
}

function printEntity(entity: any, status: any, manifest: any, showDiff: boolean, indent: number = 0, countedTypes: Set<string>) {
  const isMaterializable = countedTypes.has(entity.type);
  
  if (showDiff) {
    // In diff mode, skip non-materializable entities
    if (!isMaterializable) {
      return;
    }
    
    // Machine-parseable format: status type name file:line
    const statusStr = status.status;
    const typeStr = entity.type;
    const nameStr = entity.name;
    
    // Get file and line number
    let locationStr = '';
    if (entity.sourceFile) {
      // Try to extract relative path from sourceFile
      const parts = entity.sourceFile.split('/');
      const specsIndex = parts.lastIndexOf('specs');
      if (specsIndex >= 0) {
        const relativePath = parts.slice(specsIndex).join('/');
        // Line number would need to be tracked during parsing
        // For now, use :0 as placeholder
        locationStr = `${relativePath}:${entity.line || 0}`;
      }
    }
    
    console.log(`${statusStr} ${typeStr} ${nameStr} ${locationStr}`.trim());
  } else {
    // Human-friendly format with colors and symbols
    const indentStr = ' '.repeat(indent);
    
    if (!isMaterializable) {
      // Non-materializable: show without status symbol
      console.log(`${indentStr}  ${entity.name} (${entity.type})`);
      return;
    }
    
    let symbol = '';
    let color = '';
    
    // Display logic based on workflow states:
    // ⏳ = pending work (status=pending OR status=current with reason=needs-review)
    // ✓ = complete (status=current AND reason=reviewed)
    // ✗ = stale (deprecated, should not occur with auto-transitions)
    
    if (status.status === 'pending' || (status.status === 'current' && status.reason === 'needs-review')) {
      symbol = '⏳';
      color = '\x1b[33m'; // yellow
    } else if (status.status === 'current' && status.reason === 'reviewed') {
      symbol = '✓';
      color = '\x1b[32m'; // green
    } else {
      // Fallback for stale or unknown states
      symbol = '✗';
      color = '\x1b[31m'; // red
    }
    
    const reset = '\x1b[0m';
    const statusLine = `${indentStr}${color}${symbol}${reset} ${entity.name} (${entity.type})`;
    
    console.log(statusLine);
    
    // Show reason in brackets after the entity name
    if (status.reason) {
      console.log(`${indentStr}    [${status.reason}]`);
    }
    
    if (status.note) {
      console.log(`${indentStr}    ${status.note}`);
    }
    
    // Show diff if requested and entity is stale
    if (status.status === 'stale') {
      showEntityDiff(entity, manifest, indent);
    }
  }
}

function showEntityDiff(entity: any, manifest: Manifest, indent: number = 0) {
  const indentStr = ' '.repeat(indent);
  const oldEntry = manifest.entries.get(entity.name);
  if (!oldEntry) return;
  
  // Simple diff: show new body lines with + prefix
  const newBody = entity.body || '';
  const lines = newBody.split('\n');
  
  console.log(`${indentStr}    Diff:`);
  for (const line of lines) {
    if (line.trim()) {
      console.log(`${indentStr}    + ${line.trim()}`);
    }
  }
}

async function cmdList(cmdArgs: string[]) {
  const cwd = process.cwd();
  
  // Parse arguments
  let typeFilter: string | null = null;
  let parentFilter: string | null = null;
  
  for (let i = 0; i < cmdArgs.length; i++) {
    if ((cmdArgs[i] === '--parent' || cmdArgs[i] === '--feature') && i + 1 < cmdArgs.length) {
      parentFilter = cmdArgs[i + 1];
      i++; // Skip the parent name
    } else if (!cmdArgs[i].startsWith('--')) {
      typeFilter = cmdArgs[i];
    }
  }
  
  // Load config
  const configResult = loadConfig(cwd);
  if (!configResult.ok) {
    console.error('Error loading config:');
    for (const error of configResult.errors || []) {
      console.error(`  ${error.message}`);
    }
    process.exit(1);
  }
  
  const config = configResult.value!;
  
  // Find and parse all .bvf files
  const specsDir = join(cwd, 'specs');
  if (!existsSync(specsDir)) {
    console.error('Error: specs/ directory not found');
    process.exit(1);
  }
  
  const allEntities: any[] = [];
  const bvfFiles = findBvfFiles(specsDir, config.fileExtension);
  
  for (const file of bvfFiles) {
    const content = readFileSync(file, 'utf-8');
    const result = parseBvfFile(content, config);
    
    if (result.ok) {
      // Add source file to entities
      for (const entity of result.value || []) {
        entity.sourceFile = file;
      }
      allEntities.push(...(result.value || []));
    }
  }
  
  // Flatten children (behaviors) to top level for listing
  const flattenedEntities: any[] = [];
  for (const entity of allEntities) {
    flattenedEntities.push(entity);
    if (entity.behaviors) {
      for (const behavior of entity.behaviors) {
        flattenedEntities.push({
          ...behavior,
          type: 'behavior',
          sourceFile: entity.sourceFile
        });
      }
    }
  }
  
  let entitiesToShow = flattenedEntities;
  
  // Filter by parent - show children within that parent entity
  if (parentFilter) {
    const parent = allEntities.find(e => e.name === parentFilter);
    if (parent && parent.behaviors) {
      entitiesToShow = parent.behaviors.map((b: any) => ({
        ...b,
        type: 'behavior', // Ensure behaviors have type set
        sourceFile: parent.sourceFile
      }));
    } else {
      entitiesToShow = [];
    }
  }
  
  // Filter by type
  if (typeFilter && !parentFilter) {
    entitiesToShow = entitiesToShow.filter(e => e.type === typeFilter);
    
    if (entitiesToShow.length === 0) {
      console.log(`No entities of type '${typeFilter}' found.`);
      return;
    }
  }
  
  console.log('Entities:\n');
  
  // Simple list format showing type for each entity
  for (const entity of entitiesToShow) {
    const paramStr = entity.params?.length > 0 
      ? `(${entity.params.map((p: any) => p.name).join(', ')})` 
      : '';
    
    // Show type with each entity
    console.log(`  ${entity.type} ${entity.name}${paramStr}`);
  }
  
  console.log(`\nTotal: ${entitiesToShow.length} entities`);
}

async function cmdInit() {
  const cwd = process.cwd();
  const configPath = join(cwd, 'bvf.config');
  
  // Check if already initialized
  if (existsSync(configPath)) {
    console.error('Error: Project already initialized (bvf.config exists)');
    process.exit(1);
  }
  
  // Create bvf.config
  const config = defaultConfig();
  
  let configContent = `#config
  types: ${config.types.join(', ')}
`;
  
  // Add containment section if present
  if (config.containment && config.containment.size > 0) {
    configContent += `  containment:\n`;
    for (const [parent, children] of config.containment) {
      configContent += `    ${parent}: ${children.join(', ')}\n`;
    }
  }
  
  configContent += `  file-extension: ${config.fileExtension}
  state-dir: ${config.stateDir}
#end
`;
  writeFileSync(configPath, configContent);
  console.log('Created bvf.config');
  
  // Create specs/ directory
  const specsDir = join(cwd, 'specs');
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
    console.log('Created specs/');
  } else {
    console.log('specs/ already exists');
  }
  
  // Create .bvf-state/ directory
  const stateDir = join(cwd, config.stateDir);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
    console.log('Created .bvf-state/');
  }
  
  // Create example spec
  const examplePath = join(specsDir, 'example.bvf');
  if (!existsSync(examplePath)) {
    const exampleContent = `# Example BVF Specification

#decl surface my-app
  A sample application for demonstration.
#end

#decl fixture sample-data
  Some test data for the app.
#end

#decl instrument interact on @{my-app}
  Interact with the application.
#end

#decl behavior basic-test using @{interact}
  When interacting with @{my-app}.
  Then it should respond correctly.
#end
`;
    writeFileSync(examplePath, exampleContent);
    console.log('Created specs/example.bvf');
  }
  
  console.log('\nProject initialized! Next steps:');
  console.log('  1. Edit specs/example.bvf or create new .bvf files');
  console.log('  2. Run: bvf list        (to see all entities)');
  console.log('  3. Run: bvf resolve     (to check dependencies)');
}

async function cmdMark(cmdArgs: string[]) {
  const cwd = process.cwd();
  
  // Parse arguments: bvf mark <entity> <status> [--note "..."] [--artifact "..."] [--force]
  if (cmdArgs.length < 2) {
    console.error('Usage: bvf mark <entity> <status> [--note "..."] [--artifact "..."] [--force]');
    console.error('Status: spec-needs-elaboration, spec-reviewed, test-ready, test-reviewed, test-needs-fixing');
    process.exit(1);
  }
  
  const entityName = cmdArgs[0];
  const statusArg = cmdArgs[1];
  
  // Parse --note flag
  let note: string | undefined;
  const noteIndex = cmdArgs.indexOf('--note');
  if (noteIndex !== -1 && noteIndex + 1 < cmdArgs.length) {
    note = cmdArgs[noteIndex + 1];
  }
  
  // Parse --artifact flag
  let artifact: string | undefined;
  const artifactIndex = cmdArgs.indexOf('--artifact');
  if (artifactIndex !== -1 && artifactIndex + 1 < cmdArgs.length) {
    artifact = cmdArgs[artifactIndex + 1];
  }
  
  // Parse --force flag
  const force = cmdArgs.includes('--force');
  
  // Validate status argument
  const validStatuses = [
    'spec-needs-elaboration',
    'spec-reviewed',
    'test-ready',
    'test-reviewed',
    'test-needs-fixing'
  ];
  if (!validStatuses.includes(statusArg)) {
    console.error(`Invalid status: ${statusArg}`);
    console.error(`Valid statuses: ${validStatuses.join(', ')}`);
    process.exit(1);
  }
  
  // Validate test-ready status requires artifact
  if (statusArg === 'test-ready' && !artifact) {
    console.error('Error: artifact path is required when marking as test-ready (--artifact "...")');
    process.exit(1);
  }
  
  // Load config
  const configResult = loadConfig(cwd);
  if (!configResult.ok) {
    console.error('Error loading config:');
    for (const error of configResult.errors || []) {
      console.error(`  ${error.message}`);
    }
    process.exit(1);
  }
  
  const config = configResult.value!;
  
  // Find and parse all .bvf files to verify entity exists
  const specsDir = join(cwd, 'specs');
  if (!existsSync(specsDir)) {
    console.error('Error: specs/ directory not found');
    process.exit(1);
  }
  
  const allEntities: any[] = [];
  const bvfFiles = findBvfFiles(specsDir, config.fileExtension);
  
  for (const file of bvfFiles) {
    const content = readFileSync(file, 'utf-8');
    const result = parseBvfFile(content, config);
    
    if (result.ok) {
      allEntities.push(...(result.value || []));
    }
  }
  
  // Resolve references to get dependency info
  const resolveResult = resolveReferences(allEntities, config);
  const resolved = resolveResult.ok ? resolveResult.value! : allEntities;
  
  // Flatten behaviors to make them searchable by name
  const flattenedEntities: any[] = [];
  for (const entity of resolved) {
    flattenedEntities.push(entity);
    if (entity.behaviors) {
      for (const behavior of entity.behaviors) {
        flattenedEntities.push({
          ...behavior,
          type: 'behavior',
          // Propagate transitiveDependencies if parent has them
          transitiveDependencies: entity.transitiveDependencies || []
        });
      }
    }
  }
  
  // Check if entity exists
  const entity = flattenedEntities.find(e => e.name === entityName);
  if (!entity) {
    console.error(`Error: Entity '${entityName}' not found in specs`);
    process.exit(1);
  }
  
  // Load manifest
  const stateDir = join(cwd, config.stateDir);
  const manifest = loadManifest(stateDir);
  
  // Get current manifest entry
  let entry: ManifestEntry | undefined = manifest.entries.get(entityName);
  
  // Compute fresh hashes from current entity state
  const specHash = computeSpecHash(entity);
  const currentHashes = new Map<string, string>();
  for (const e of resolved) {
    currentHashes.set(e.name, computeSpecHash(e));
  }
  const dependencyHash = computeDependencyHash(entity, currentHashes);
  
  // Check for staleness if entry exists and we're trying to bless
  // Note: Skip staleness check for test-reviewed (only reviewing test alignment, spec shouldn't change)
  if (entry && !force && statusArg === 'spec-reviewed') {
    // Special case: when transitioning from needs-elaboration to spec-reviewed,
    // allow hash update (this is the re-review after elaboration)
    const isReReviewAfterElaboration = entry.reason === 'needs-elaboration';
    
    // Check if spec has changed since last manifest state (unless re-reviewing after elaboration)
    if (!isReReviewAfterElaboration && entry.specHash && entry.specHash !== specHash) {
      console.error(`Error: entity has changed since last state (${entry.reason || 'unknown'}).`);
      console.error(`Run 'bvf resolve' to validate changes before marking as ${statusArg}.`);
      console.error(`Or use --force to update hashes anyway.`);
      process.exit(1);
    }
  }
  
  // Handle different workflow transitions
  let newEntry: ManifestEntry;
  
  switch (statusArg) {
    case 'spec-needs-elaboration':
      newEntry = {
        name: entityName,
        status: 'pending',
        reason: 'needs-elaboration',
        specHash: entry?.specHash || specHash,
        dependencyHash: entry?.dependencyHash || dependencyHash,
        ...(note && { note }),
        ...(entry?.artifact && { artifact: entry.artifact })
      };
      break;
      
    case 'spec-reviewed':
      // When transitioning FROM needs-elaboration, always update hashes (this is the re-review after elaboration)
      // For other states, the staleness check above will catch mismatches
      newEntry = {
        name: entityName,
        status: 'pending',
        reason: 'reviewed',
        specHash,
        dependencyHash,
        ...(entry?.artifact && { artifact: entry.artifact })
      };
      break;
      
    case 'test-ready':
      // Entity must be spec-reviewed first (entry exists)
      // Reject if:
      // 1. No entry (never reviewed)
      // 2. Entry exists but is in needs-elaboration state
      if (!entry) {
        console.error('Error: cannot mark as test-ready. Entity must be spec-reviewed first.');
        process.exit(1);
      }
      
      if (entry.reason === 'needs-elaboration') {
        console.error('Error: cannot mark as test-ready. Entity is in needs-elaboration state and must be spec-reviewed first.');
        process.exit(1);
      }
      
      newEntry = {
        name: entityName,
        status: 'current',
        reason: 'needs-review',
        specHash,
        dependencyHash,
        artifact: artifact!,
        materializedAt: new Date().toISOString()
      };
      break;
      
    case 'test-reviewed':
      // Must be in test-ready state (current, needs-review) or have an artifact
      if (!entry || entry.status !== 'current' || !entry.artifact) {
        console.error('Error: cannot mark as test-reviewed. Entity must be test-ready first (must have artifact).');
        process.exit(1);
      }
      
      // Update hashes to ensure they match current spec state
      // (prevents staleness detection on next resolve)
      newEntry = {
        name: entry.name,
        status: entry.status,
        reason: 'reviewed',
        specHash,
        dependencyHash,
        artifact: entry.artifact,
        materializedAt: entry.materializedAt
      };
      break;
      
    case 'test-needs-fixing':
      // Must have a test (current status)
      if (!entry || entry.status !== 'current') {
        console.error('Error: cannot mark as test-needs-fixing. Entity must have a test first.');
        process.exit(1);
      }
      
      newEntry = {
        name: entityName,
        status: 'pending',
        reason: 'reviewed',
        specHash: entry.specHash,
        dependencyHash: entry.dependencyHash,
        artifact: entry.artifact, // Preserve artifact
        ...(note && { note })
      };
      break;
      
    default:
      console.error(`Invalid status: ${statusArg}`);
      process.exit(1);
  }
  
  // Save updated manifest
  manifest.entries.set(entityName, newEntry);
  saveManifest(stateDir, manifest);
  
  console.log(`Marked ${entityName} as ${newEntry.status} (${newEntry.reason})`);
  if (note) {
    console.log(`Note: ${note}`);
  }
  if (artifact) {
    console.log(`Artifact: ${artifact}`);
  }
  
  process.exit(0);
}

function findBvfFiles(dir: string, extension: string): string[] {
  const files: string[] = [];
  
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...findBvfFiles(fullPath, extension));
    } else if (fullPath.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
