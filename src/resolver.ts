import type { 
  Entity, 
  ResolvedEntity, 
  ResolveResult, 
  BvfConfig, 
  DependencyGraph 
} from './types.js';

/**
 * Validate references and resolve dependencies
 */
export function resolveReferences(
  entities: Entity[], 
  config?: BvfConfig
): ResolveResult {
  const errors: Error[] = [];
  
  // Build entity map
  const entityMap = new Map<string, Entity>();
  for (const entity of entities) {
    entityMap.set(entity.name, entity);
  }
  
  // Validate entity types if config provided
  if (config) {
    for (const entity of entities) {
      if (!config.types.includes(entity.type)) {
        const suggestions = config.types.slice(0, 3).join(', ');
        errors.push(
          new Error(
            `Unknown entity type "${entity.type}" for ${entity.name}. ` +
            `Valid types: ${suggestions}${config.types.length > 3 ? '...' : ''}`
          )
        );
      }
    }
  }
  
  // Validate references
  for (const entity of entities) {
    for (const ref of entity.references) {
      const target = entityMap.get(ref.name);
      
      if (!target) {
        const locationInfo = entity.sourceFile ? ` in ${entity.sourceFile}` : '';
        errors.push(
          new Error(`Reference @{${ref.name}} is unresolved${locationInfo}`)
        );
        continue;
      }
      
      // Check if bare reference to entity with required params
      if (!ref.args && target.params.some(p => p.required)) {
        errors.push(
          new Error(
            `${entity.name} references ${ref.name} without arguments, ` +
            `but ${ref.name} requires params: ${target.params.filter(p => p.required).map(p => p.name).join(', ')}`
          )
        );
        continue;
      }
      
      // Validate arguments if provided
      if (ref.args) {
        const targetParamNames = new Set(target.params.map(p => p.name));
        const requiredParams = target.params.filter(p => p.required);
        
        // Check for unknown params first
        for (const argName of Object.keys(ref.args)) {
          if (!targetParamNames.has(argName)) {
            const validParams = target.params.map(p => p.name).join(', ');
            errors.push(
              new Error(
                `Unknown parameter "${argName}" in reference to ${ref.name}. ` +
                `Valid params: ${validParams}`
              )
            );
          }
        }
        
        // Check for missing required params
        for (const param of requiredParams) {
          if (!ref.args[param.name]) {
            errors.push(
              new Error(
                `Reference @{${ref.name}} in ${entity.name} is missing required param: ${param.name}`
              )
            );
          }
        }
      }
    }
  }
  
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  
  // Build dependency graph
  const graph = buildDependencyGraph(entities);
  
  // Check for cycles
  if (graph.hasCycle()) {
    const cycle = graph.getCycle()!;
    errors.push(
      new Error(`Circular dependency detected: ${cycle.join(' -> ')}`)
    );
    return { ok: false, errors };
  }
  
  // Build resolved entities with dependencies
  const resolved: ResolvedEntity[] = [];
  
  for (const entity of entities) {
    const resolvedEntity: ResolvedEntity = {
      ...entity,
      dependencies: graph.getDirectDependencies(entity.name),
      transitiveDependencies: graph.getTransitiveDependencies(entity.name)
    };
    resolved.push(resolvedEntity);
    
    // Extract behaviors from features as separate entities
    if (entity.type === 'feature' && entity.behaviors) {
      for (const behavior of entity.behaviors) {
        const behaviorEntity: ResolvedEntity = {
          type: 'behavior',
          name: behavior.name,
          params: behavior.params || [],
          clauses: {},
          body: behavior.body || '',
          references: [],
          paramUsages: [],
          context: behavior.context,
          sourceFile: entity.sourceFile,
          dependencies: [],
          transitiveDependencies: []
        };
        resolved.push(behaviorEntity);
      }
    }
  }
  
  return { ok: true, value: resolved };
}

/**
 * Build dependency graph from entities
 */
export function buildDependencyGraph(entities: Entity[]): DependencyGraph {
  const nodes: string[] = entities.map(e => e.name);
  const edges = new Map<string, string[]>();
  
  // Initialize edges
  for (const entity of entities) {
    edges.set(entity.name, []);
  }
  
  // Build edges from references
  for (const entity of entities) {
    const deps = new Set<string>();
    
    for (const ref of entity.references) {
      deps.add(ref.name);
    }
    
    edges.set(entity.name, Array.from(deps));
  }
  
  return {
    nodes,
    edges,
    
    getDirectDependencies(name: string): string[] {
      return edges.get(name) || [];
    },
    
    getTransitiveDependencies(name: string): string[] {
      const visited = new Set<string>();
      const result: string[] = [];
      
      const visit = (node: string) => {
        if (visited.has(node)) return;
        visited.add(node);
        
        const deps = edges.get(node) || [];
        for (const dep of deps) {
          if (!visited.has(dep)) {
            result.push(dep);
            visit(dep);
          }
        }
      };
      
      visit(name);
      
      return result;
    },
    
    hasCycle(): boolean {
      const visited = new Set<string>();
      const recStack = new Set<string>();
      
      const detectCycle = (node: string): boolean => {
        if (recStack.has(node)) return true;
        if (visited.has(node)) return false;
        
        visited.add(node);
        recStack.add(node);
        
        const deps = edges.get(node) || [];
        for (const dep of deps) {
          if (detectCycle(dep)) return true;
        }
        
        recStack.delete(node);
        return false;
      };
      
      for (const node of nodes) {
        if (detectCycle(node)) return true;
      }
      
      return false;
    },
    
    getCycle(): string[] | null {
      const visited = new Set<string>();
      const recStack = new Set<string>();
      const parent = new Map<string, string>();
      
      const detectCycle = (node: string, path: string[]): string[] | null => {
        if (recStack.has(node)) {
          // Found cycle - extract it
          const cycleStart = path.indexOf(node);
          if (cycleStart >= 0) {
            return [...path.slice(cycleStart), node];
          }
          return path;
        }
        if (visited.has(node)) return null;
        
        visited.add(node);
        recStack.add(node);
        
        const deps = edges.get(node) || [];
        for (const dep of deps) {
          const result = detectCycle(dep, [...path, node]);
          if (result) {
            return result;
          }
        }
        
        recStack.delete(node);
        return null;
      };
      
      for (const node of nodes) {
        const cycle = detectCycle(node, []);
        if (cycle) {
          return cycle;
        }
      }
      
      return null;
    }
  };
}
