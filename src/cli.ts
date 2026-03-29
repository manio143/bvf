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

const commands = ['resolve', 'list', 'init'];

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || !commands.includes(command)) {
    console.error('Usage: bvf <command> [options]');
    console.error('Commands: resolve, list, init');
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
    const result = parseBvfFile(content);
    
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
  
  // Check status of each entity
  let pendingCount = 0;
  let currentCount = 0;
  let staleCount = 0;
  
  console.log('Resolution Status:\n');
  
  for (const entity of resolved) {
    const status = getEntityStatus(entity, manifest, currentHashes);
    
    let symbol = '';
    let color = '';
    
    switch (status.status) {
      case 'pending':
        symbol = '○';
        color = '\x1b[33m'; // yellow
        pendingCount++;
        break;
      case 'current':
        symbol = '✓';
        color = '\x1b[32m'; // green
        currentCount++;
        break;
      case 'stale':
        symbol = '✗';
        color = '\x1b[31m'; // red
        staleCount++;
        break;
    }
    
    const reset = '\x1b[0m';
    const statusLine = `${color}${symbol}${reset} ${entity.name} (${entity.type})`;
    
    console.log(statusLine);
    
    if (status.reason) {
      console.log(`    ${status.reason}`);
    }
    
    // Show diff if requested and entity is stale
    if (showDiff && status.status === 'stale') {
      showEntityDiff(entity, manifest);
    }
  }
  
  // Check for orphaned entries
  const orphaned = findOrphanedEntries(manifest, resolved);
  
  if (orphaned.length > 0) {
    console.log('\nOrphaned (removed from specs):');
    for (const name of orphaned) {
      console.log(`  ${name}`);
    }
  }
  
  console.log(`\nSummary:`);
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

function showEntityDiff(entity: any, manifest: Manifest) {
  const oldEntry = manifest.entries.get(entity.name);
  if (!oldEntry) return;
  
  // Simple diff: show new body lines with + prefix
  const newBody = entity.body || '';
  const lines = newBody.split('\n');
  
  console.log('    Diff:');
  for (const line of lines) {
    if (line.trim()) {
      console.log(`    + ${line.trim()}`);
    }
  }
}

async function cmdList(cmdArgs: string[]) {
  const cwd = process.cwd();
  
  // Parse arguments
  let typeFilter: string | null = null;
  let featureFilter: string | null = null;
  
  for (let i = 0; i < cmdArgs.length; i++) {
    if (cmdArgs[i] === '--feature' && i + 1 < cmdArgs.length) {
      featureFilter = cmdArgs[i + 1];
      i++; // Skip the feature name
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
    const result = parseBvfFile(content);
    
    if (result.ok) {
      // Add source file to entities
      for (const entity of result.value || []) {
        entity.sourceFile = file;
      }
      allEntities.push(...(result.value || []));
    }
  }
  
  let entitiesToShow = allEntities;
  
  // Filter by feature - show behaviors within that feature
  if (featureFilter) {
    const feature = allEntities.find(e => e.type === 'feature' && e.name === featureFilter);
    if (feature && feature.behaviors) {
      entitiesToShow = feature.behaviors.map((b: any) => ({
        ...b,
        type: 'behavior', // Ensure behaviors have type set
        sourceFile: feature.sourceFile
      }));
    } else {
      entitiesToShow = [];
    }
  }
  
  // Filter by type
  if (typeFilter && !featureFilter) {
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
  const configContent = `#config
  types: ${config.types.join(', ')}
  file-extension: ${config.fileExtension}
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
