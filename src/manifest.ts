import type { Entity, ResolvedEntity, Manifest, ManifestEntry, EntityStatus } from './types.js';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Load manifest from state directory
 */
export function loadManifest(stateDir: string): Manifest {
  const manifestPath = join(stateDir, 'manifest.json');
  
  if (!existsSync(manifestPath)) {
    return { entries: new Map() };
  }
  
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    
    const entries = new Map<string, ManifestEntry>();
    for (const [name, entry] of Object.entries(data)) {
      entries.set(name, entry as ManifestEntry);
    }
    
    return { entries };
  } catch (error) {
    // Return empty manifest on parse errors
    return { entries: new Map() };
  }
}

/**
 * Save manifest to state directory
 */
export function saveManifest(stateDir: string, manifest: Manifest): void {
  const manifestPath = join(stateDir, 'manifest.json');
  
  // Ensure state directory exists
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  
  // Convert Map to object for JSON serialization
  const data: Record<string, ManifestEntry> = {};
  for (const [name, entry] of manifest.entries) {
    data[name] = entry;
  }
  
  writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Compute hash of entity spec content
 */
export function computeSpecHash(entity: Entity | ResolvedEntity): string {
  const hash = createHash('sha256');
  
  // Hash type, name, params, and body
  hash.update(entity.type || '');
  hash.update(entity.name || '');
  hash.update(JSON.stringify(entity.params || []));
  hash.update(entity.body || '');
  
  // Include context if present
  if (entity.context) {
    hash.update(entity.context);
  }
  
  // Include behaviors for features
  if (entity.behaviors) {
    for (const behavior of entity.behaviors) {
      hash.update(behavior.name || '');
      hash.update(behavior.body || '');
      if (behavior.context) {
        hash.update(behavior.context);
      }
    }
  }
  
  return hash.digest('hex');
}

/**
 * Compute hash of entity's dependencies
 */
export function computeDependencyHash(
  entity: Entity | ResolvedEntity,
  entityHashes: Map<string, string>
): string {
  const hash = createHash('sha256');
  
  // Get transitive dependencies
  const deps = 'transitiveDependencies' in entity 
    ? entity.transitiveDependencies 
    : [];
  
  // Sort for deterministic hash
  const sortedDeps = [...deps].sort();
  
  for (const depName of sortedDeps) {
    const depHash = entityHashes.get(depName);
    if (depHash) {
      hash.update(depName);
      hash.update(depHash);
    }
  }
  
  return hash.digest('hex');
}

/**
 * Get status of an entity (pending/current/stale)
 */
export function getEntityStatus(
  entity: Entity | ResolvedEntity,
  manifest: Manifest,
  currentHashes?: Map<string, string>
): EntityStatus {
  const entry = manifest.entries.get(entity.name);
  
  if (!entry) {
    return {
      name: entity.name,
      status: 'pending'
    };
  }
  
  // Check if spec content changed
  const currentSpecHash = computeSpecHash(entity);
  if (currentSpecHash !== entry.specHash) {
    return {
      name: entity.name,
      status: 'stale',
      reason: 'Content has changed'
    };
  }
  
  // Check if dependencies changed
  if (currentHashes) {
    const currentDepHash = computeDependencyHash(entity, currentHashes);
    if (currentDepHash !== entry.dependencyHash) {
      // Find which direct dependency changed (or its transitive deps)
      const directDeps = 'dependencies' in entity ? entity.dependencies : [];
      const transitiveDeps = 'transitiveDependencies' in entity ? entity.transitiveDependencies : [];
      
      // Check direct dependencies first
      for (const depName of directDeps) {
        const currentHash = currentHashes.get(depName);
        const oldEntry = manifest.entries.get(depName);
        
        if (oldEntry && currentHash && currentHash !== oldEntry.specHash) {
          return {
            name: entity.name,
            status: 'stale',
            reason: `Dependency ${depName} has changed`
          };
        }
      }
      
      // If no direct dep changed, check transitive
      for (const depName of transitiveDeps) {
        if (directDeps.includes(depName)) continue; // Already checked
        
        const currentHash = currentHashes.get(depName);
        const oldEntry = manifest.entries.get(depName);
        
        if (oldEntry && currentHash && currentHash !== oldEntry.specHash) {
          // Find which direct dep leads to this transitive dep
          for (const directDep of directDeps) {
            const directDepEntity = manifest.entries.get(directDep);
            if (directDepEntity) {
              // This is a simplified check - just report the direct dep
              return {
                name: entity.name,
                status: 'stale',
                reason: `Dependency ${directDep} has changed`
              };
            }
          }
        }
      }
      
      return {
        name: entity.name,
        status: 'stale',
        reason: 'One or more dependencies have changed'
      };
    }
  }
  
  return {
    name: entity.name,
    status: 'current'
  };
}

/**
 * Record a materialization in the manifest
 */
export function recordMaterialization(
  manifest: Manifest,
  name: string,
  artifact: string,
  specHash: string,
  dependencyHash: string
): Manifest {
  const entry: ManifestEntry = {
    name,
    specHash,
    dependencyHash,
    artifact,
    materializedAt: new Date().toISOString()
  };
  
  const newEntries = new Map(manifest.entries);
  newEntries.set(name, entry);
  
  return { entries: newEntries };
}

/**
 * Find orphaned entries (in manifest but not in current entities)
 */
export function findOrphanedEntries(
  manifest: Manifest,
  currentEntities: (Entity | ResolvedEntity)[]
): string[] {
  const currentNames = new Set(currentEntities.map(e => e.name));
  const orphaned: string[] = [];
  
  for (const [name] of manifest.entries) {
    if (!currentNames.has(name)) {
      orphaned.push(name);
    }
  }
  
  return orphaned;
}
