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
import type { ResolvedEntity, Manifest } from './types.js';

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
  
  for (const file of bvfFiles) {
    const content = readFileSync(file, 'utf-8');
    const result = parseBvfFile(content, config);
    
    if (!result.ok) {
      parseErrors.push(...(result.errors || []));
      continue;
    }
    
    // Add source file to entities
    for (const entity of result.value || []) {
      entity.sourceFile = file;
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
  
  // Load manifest
  const stateDir = join(cwd, config.stateDir);
  const manifest = loadManifest(stateDir);
  
  // Compute current hashes
  const currentHashes = new Map<string, string>();
  for (const entity of resolved) {
    currentHashes.set(entity.name, computeSpecHash(entity));
  }
  
  // Build map of behaviors to their parent features
  const behaviorToFeature = new Map<string, string>();
  for (const entity of resolved) {
    if (entity.type === 'feature' && entity.behaviors) {
      for (const behavior of entity.behaviors) {
        behaviorToFeature.set(behavior.name, entity.name);
      }
    }
  }
  
  // Check status of each entity
  let pendingCount = 0;
  let currentCount = 0;
  let staleCount = 0;
  
  // Build a map of statuses
  const entityStatuses = new Map<string, any>();
  for (const entity of resolved) {
    const status = getEntityStatus(entity, manifest, currentHashes);
    entityStatuses.set(entity.name, status);
    
    // Only count non-feature entities in summary
    if (entity.type !== 'feature') {
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
  
  // Group entities by feature
  const features: Array<{ feature: any | null; entities: any[]; hasIssues: boolean }> = [];
  const featureMap = new Map<string, any>();
  const standalone: any[] = [];
  
  for (const entity of resolved) {
    if (entity.type === 'feature') {
      featureMap.set(entity.name, entity);
    }
  }
  
  // Process features first
  for (const [featureName, feature] of featureMap) {
    const behaviors = feature.behaviors || [];
    let hasIssues = false;
    
    // Check if any of the feature's behaviors have issues
    // (The feature entity itself is a container — its status doesn't
    // determine ordering. Only behavior statuses matter.)
    for (const behavior of behaviors) {
      const behaviorStatus = entityStatuses.get(behavior.name);
      if (behaviorStatus && (behaviorStatus.status === 'stale' || behaviorStatus.status === 'pending')) {
        hasIssues = true;
        break;
      }
    }
    
    features.push({ feature, entities: [feature, ...behaviors], hasIssues });
  }
  
  // Collect standalone entities (not features and not behaviors in features)
  for (const entity of resolved) {
    if (entity.type !== 'feature' && !behaviorToFeature.has(entity.name)) {
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
  
  // Sort features: clean first (alphabetically), then problematic (alphabetically)
  const cleanFeatures = features.filter(f => !f.hasIssues).sort((a, b) => 
    (a.feature?.name || '').localeCompare(b.feature?.name || '')
  );
  const problematicFeatures = features.filter(f => f.hasIssues).sort((a, b) => 
    (a.feature?.name || '').localeCompare(b.feature?.name || '')
  );
  
  console.log('Resolution Status:\n');
  
  // Print clean features first
  for (const { feature, entities } of cleanFeatures) {
    printFeatureGroup(feature, entities, entityStatuses, manifest, showDiff);
  }
  
  // Print standalone entities (if they're clean, before problematic features)
  if (standalone.length > 0 && !standaloneHasIssues) {
    for (const entity of standalone) {
      printEntity(entity, entityStatuses.get(entity.name), manifest, showDiff);
    }
    console.log('');
  }
  
  // Print problematic features
  for (const { feature, entities } of problematicFeatures) {
    printFeatureGroup(feature, entities, entityStatuses, manifest, showDiff);
  }
  
  // Print standalone entities if they have issues (at the end)
  if (standalone.length > 0 && standaloneHasIssues) {
    for (const entity of standalone) {
      printEntity(entity, entityStatuses.get(entity.name), manifest, showDiff);
    }
    console.log('');
  }
  
  // Check for orphaned entries
  const orphaned = findOrphanedEntries(manifest, resolved);
  
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
  console.log(`  Total: ${resolved.length}`);
  
  if (staleCount > 0 || pendingCount > 0) {
    console.log('\nRun materialization to generate/update test files.');
  }
  
  if (errorCount > 0) {
    process.exit(1);
  }
}

function printFeatureGroup(feature: any, entities: any[], statuses: Map<string, any>, manifest: any, showDiff: boolean) {
  // Print feature itself
  const featureStatus = statuses.get(feature.name);
  if (featureStatus) {
    printEntity(feature, featureStatus, manifest, showDiff, 0);
  }
  
  // Print behaviors nested under feature
  for (const entity of entities) {
    if (entity !== feature) {
      const status = statuses.get(entity.name);
      if (status) {
        printEntity(entity, status, manifest, showDiff, 2);
      }
    }
  }
  
  console.log('');
}

function printEntity(entity: any, status: any, manifest: any, showDiff: boolean, indent: number = 0) {
  const indentStr = ' '.repeat(indent);
  
  let symbol = '';
  let color = '';
  
  switch (status.status) {
    case 'pending':
      symbol = '⏳';
      color = '\x1b[33m'; // yellow
      break;
    case 'current':
      symbol = '✓';
      color = '\x1b[32m'; // green
      break;
    case 'stale':
      symbol = '✗';
      color = '\x1b[31m'; // red
      break;
  }
  
  const reset = '\x1b[0m';
  const statusLine = `${indentStr}${color}${symbol}${reset} ${entity.name} (${entity.type})`;
  
  console.log(statusLine);
  
  if (status.reason) {
    console.log(`${indentStr}    ${status.reason}`);
  }
  
  if (status.note) {
    console.log(`${indentStr}    ${status.note}`);
  }
  
  // Show diff if requested and entity is stale
  if (showDiff && status.status === 'stale') {
    showEntityDiff(entity, manifest, indent);
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
  
  // Group by type
  const byType = new Map<string, any[]>();
  for (const entity of entitiesToShow) {
    if (!byType.has(entity.type)) {
      byType.set(entity.type, []);
    }
    byType.get(entity.type)!.push(entity);
  }
  
  for (const [type, entities] of byType) {
    console.log(`${type}:`);
    for (const entity of entities) {
      const paramStr = entity.params?.length > 0 
        ? `(${entity.params.map((p: any) => p.name).join(', ')})` 
        : '';
      
      // Show source file if available
      let sourceInfo = '';
      if (entity.sourceFile) {
        const relativePath = entity.sourceFile.replace(specsDir + '/', '');
        sourceInfo = `  ${relativePath}`;
      }
      
      console.log(`  ${entity.name}${paramStr}${sourceInfo}`);
    }
    console.log('');
  }
  
  console.log(`Total: ${entitiesToShow.length} entities`);
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
  
  // Parse arguments: bvf mark <entity> <status> [--note "..."]
  if (cmdArgs.length < 2) {
    console.error('Usage: bvf mark <entity> <status> [--note "..."]');
    console.error('Status: needs-elaboration, review-failed');
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
  
  // Validate status argument
  const validStatuses = ['needs-elaboration', 'review-failed'];
  if (!validStatuses.includes(statusArg)) {
    console.error(`Invalid status: ${statusArg}`);
    console.error(`Valid statuses: ${validStatuses.join(', ')}`);
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
  
  // Check if entity exists
  const entity = allEntities.find(e => e.name === entityName);
  if (!entity) {
    console.error(`Error: Entity '${entityName}' not found in specs`);
    process.exit(1);
  }
  
  // Load manifest
  const stateDir = join(cwd, config.stateDir);
  const manifest = loadManifest(stateDir);
  
  // Get or create manifest entry
  let entry = manifest.entries.get(entityName);
  if (!entry) {
    // Create new entry
    const specHash = computeSpecHash(entity);
    entry = {
      name: entityName,
      specHash,
      dependencyHash: specHash, // Initial value
    };
  }
  
  // Update status based on status argument
  if (statusArg === 'needs-elaboration') {
    entry.status = 'pending';
    entry.reason = 'needs-elaboration';
  } else if (statusArg === 'review-failed') {
    entry.status = 'stale';
    entry.reason = 'review-failed';
  }
  
  if (note) {
    entry.note = note;
  }
  
  // Save updated manifest
  manifest.entries.set(entityName, entry);
  saveManifest(stateDir, manifest);
  
  console.log(`Marked ${entityName} as ${entry.status} (${entry.reason})`);
  if (note) {
    console.log(`Note: ${note}`);
  }
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
