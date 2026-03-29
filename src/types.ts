// Core type definitions for BVF

export interface Param {
  name: string;
  required: boolean;
  defaultValue?: string;
}

export interface Reference {
  name: string;
  args?: Record<string, string | { param: string }>;
}

export interface Behavior {
  name: string;
  params: Param[];
  body: string;
  context?: string;
}

export interface Entity {
  type: string;
  name: string;
  params: Param[];
  clauses: Record<string, Reference>;
  body: string;
  references: Reference[];
  paramUsages: string[];
  behaviors?: Behavior[];
  context?: string;
  sourceFile?: string;
}

export interface ParseResult {
  ok: boolean;
  value?: Entity[];
  errors?: Error[];
}

export interface ResolvedEntity extends Entity {
  dependencies: string[];
  transitiveDependencies: string[];
}

export interface ResolveResult {
  ok: boolean;
  value?: ResolvedEntity[];
  errors?: Error[];
}

export interface BvfConfig {
  types: string[];
  fileExtension: string;
  stateDir: string;
}

export interface ConfigResult {
  ok: boolean;
  value?: BvfConfig;
  errors?: Error[];
}

export interface ManifestEntry {
  name: string;
  specHash: string;
  dependencyHash: string;
  artifact?: string;
  materializedAt?: string;
}

export interface Manifest {
  entries: Map<string, ManifestEntry>;
}

export interface EntityStatus {
  name: string;
  status: 'pending' | 'current' | 'stale' | 'orphaned';
  reason?: string;
}

export interface DependencyGraph {
  nodes: string[];
  edges: Map<string, string[]>;
  getDirectDependencies(name: string): string[];
  getTransitiveDependencies(name: string): string[];
  hasCycle(): boolean;
  getCycle(): string[] | null;
}
