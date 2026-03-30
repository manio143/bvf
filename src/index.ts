// Public API exports for BVF

export { parseBvfFile } from './parser.js';
export { parseConfig, loadConfig, defaultConfig } from './config.js';
export { resolveReferences, buildDependencyGraph } from './resolver.js';
export {
  loadManifest,
  saveManifest,
  computeSpecHash,
  computeDependencyHash,
  getEntityStatus,
  recordMaterialization,
  findOrphanedEntries
} from './manifest.js';

export type {
  Entity,
  Param,
  Reference,
  Behavior,
  ParseResult,
  ResolvedEntity,
  ResolveResult,
  BvfConfig,
  ConfigResult,
  Manifest,
  ManifestEntry,
  EntityStatus,
  DependencyGraph
} from './types.js';
