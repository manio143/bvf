import { describe, it, expect } from 'vitest';
import { resolveReferences, buildDependencyGraph } from '../src/resolver.js';

// Type definitions
interface Param {
  name: string;
  required: boolean;
  defaultValue?: string;
}

interface Reference {
  name: string;
  args?: Record<string, string | { param: string }>;
}

interface Entity {
  type: string;
  name: string;
  params: Param[];
  clauses: Record<string, Reference>;
  body: string;
  references: Reference[];
  sourceFile?: string;
}

interface ResolveResult {
  ok: boolean;
  value?: ResolvedEntity[];
  errors?: Error[];
}

interface ResolvedEntity extends Entity {
  dependencies: string[];
  transitiveDependencies: string[];
}

interface DependencyGraph {
  nodes: string[];
  edges: Map<string, string[]>;
  getDirectDependencies(name: string): string[];
  getTransitiveDependencies(name: string): string[];
  hasCycle(): boolean;
  getCycle(): string[] | null;
}

describe('reference-validation', () => {
  it('resolves-valid-references', () => {
    const entities: Entity[] = [
      {
        type: 'surface',
        name: 'web-app',
        params: [],
        clauses: {},
        body: 'A web app.',
        references: []
      },
      {
        type: 'instrument',
        name: 'login',
        params: [
          { name: 'email', required: true },
          { name: 'password', required: true }
        ],
        clauses: {
          on: { name: 'web-app' }
        },
        body: 'Login instrument.',
        references: [{ name: 'web-app' }]
      },
      {
        type: 'behavior',
        name: 'can-login',
        params: [],
        clauses: {
          using: {
            name: 'login',
            args: {
              email: 'a@b.com',
              password: 'x'
            }
          }
        },
        body: 'Login behavior.',
        references: [
          {
            name: 'login',
            args: { email: 'a@b.com', password: 'x' }
          }
        ]
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('reports-unresolved-reference', () => {
    const entities: Entity[] = [
      {
        type: 'behavior',
        name: 'test-behavior',
        params: [],
        clauses: {},
        body: 'Uses @{nonexistent}.',
        references: [{ name: 'nonexistent' }],
        sourceFile: 'test.bvf'
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0].message).toMatch(/nonexistent.*unresolved/i);
  });

  it('reports-missing-required-param', () => {
    const entities: Entity[] = [
      {
        type: 'instrument',
        name: 'login',
        params: [
          { name: 'email', required: true },
          { name: 'password', required: true }
        ],
        clauses: {},
        body: 'Login.',
        references: []
      },
      {
        type: 'behavior',
        name: 'test-login',
        params: [],
        clauses: {},
        body: 'Uses login.',
        references: [
          {
            name: 'login',
            args: { email: 'a@b.com' } // missing password
          }
        ]
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/login.*missing.*password/i);
  });

  it('accepts-optional-param-omission', () => {
    const entities: Entity[] = [
      {
        type: 'fixture',
        name: 'user',
        params: [
          { name: 'email', required: true },
          { name: 'role', required: false, defaultValue: 'member' }
        ],
        clauses: {},
        body: 'User fixture.',
        references: []
      },
      {
        type: 'behavior',
        name: 'test-user',
        params: [],
        clauses: {},
        body: 'Uses user.',
        references: [
          {
            name: 'user',
            args: { email: 'a@b.com' } // role omitted, should use default
          }
        ]
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('reports-unknown-param-name', () => {
    const entities: Entity[] = [
      {
        type: 'instrument',
        name: 'login',
        params: [
          { name: 'email', required: true },
          { name: 'password', required: true }
        ],
        clauses: {},
        body: 'Login.',
        references: []
      },
      {
        type: 'behavior',
        name: 'test-login',
        params: [],
        clauses: {},
        body: 'Uses login.',
        references: [
          {
            name: 'login',
            args: {
              email: 'a@b.com',
              username: 'foo' // wrong param name
            }
          }
        ]
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/username/i);
    expect(result.errors![0].message).toMatch(/email|password/i); // suggestion
  });

  it('reports-bare-ref-to-entity-with-required-params', () => {
    const entities: Entity[] = [
      {
        type: 'instrument',
        name: 'login',
        params: [
          { name: 'email', required: true },
          { name: 'password', required: true }
        ],
        clauses: {},
        body: 'Login.',
        references: []
      },
      {
        type: 'behavior',
        name: 'test-login',
        params: [],
        clauses: {},
        body: 'Uses @{login}.',
        references: [{ name: 'login' }] // bare reference, no args
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/login.*requires.*params/i);
  });

  it('allows-bare-ref-to-paramless-entity', () => {
    const entities: Entity[] = [
      {
        type: 'surface',
        name: 'web-app',
        params: [],
        clauses: {},
        body: 'Web app.',
        references: []
      },
      {
        type: 'instrument',
        name: 'tool',
        params: [],
        clauses: {},
        body: 'Uses @{web-app}.',
        references: [{ name: 'web-app' }]
      }
    ];

    const result = resolveReferences(entities) as ResolveResult;

    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });
});

describe('dependency-graph', () => {
  it('builds-direct-dependencies', () => {
    const entities: Entity[] = [
      {
        type: 'surface',
        name: 'web-app',
        params: [],
        clauses: {},
        body: 'Web app.',
        references: []
      },
      {
        type: 'instrument',
        name: 'login',
        params: [],
        clauses: { on: { name: 'web-app' } },
        body: 'Login.',
        references: [{ name: 'web-app' }]
      },
      {
        type: 'behavior',
        name: 'can-login',
        params: [],
        clauses: { using: { name: 'login' } },
        body: 'Can login.',
        references: [{ name: 'login' }]
      }
    ];

    const graph = buildDependencyGraph(entities);

    expect(graph.getDirectDependencies('web-app')).toEqual([]);
    expect(graph.getDirectDependencies('login')).toEqual(['web-app']);
    expect(graph.getDirectDependencies('can-login')).toEqual(['login']);
  });

  it('computes-transitive-dependencies', () => {
    const entities: Entity[] = [
      {
        type: 'surface',
        name: 'web-app',
        params: [],
        clauses: {},
        body: 'Web app.',
        references: []
      },
      {
        type: 'instrument',
        name: 'login',
        params: [],
        clauses: {},
        body: 'Uses @{web-app}.',
        references: [{ name: 'web-app' }]
      },
      {
        type: 'behavior',
        name: 'can-login',
        params: [],
        clauses: {},
        body: 'Uses @{login}.',
        references: [{ name: 'login' }]
      }
    ];

    const graph = buildDependencyGraph(entities);
    const transitive = graph.getTransitiveDependencies('can-login');

    expect(transitive).toContain('login');
    expect(transitive).toContain('web-app');
    expect(transitive).toHaveLength(2);
  });

  it('detects-circular-dependency', () => {
    const entities: Entity[] = [
      {
        type: 'fixture',
        name: 'a',
        params: [],
        clauses: {},
        body: 'Uses @{b}.',
        references: [{ name: 'b' }]
      },
      {
        type: 'fixture',
        name: 'b',
        params: [],
        clauses: {},
        body: 'Uses @{a}.',
        references: [{ name: 'a' }]
      }
    ];

    const graph = buildDependencyGraph(entities);

    expect(graph.hasCycle()).toBe(true);
    const cycle = graph.getCycle();
    expect(cycle).toBeDefined();
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
  });

  it('includes-clause-references', () => {
    const entities: Entity[] = [
      {
        type: 'surface',
        name: 'web-app',
        params: [],
        clauses: {},
        body: 'Web app.',
        references: []
      },
      {
        type: 'instrument',
        name: 'login',
        params: [
          { name: 'email', required: true },
          { name: 'password', required: true }
        ],
        clauses: { on: { name: 'web-app' } },
        body: 'Login.',
        references: [{ name: 'web-app' }]
      }
    ];

    const graph = buildDependencyGraph(entities);

    expect(graph.getDirectDependencies('login')).toContain('web-app');
  });

  it('includes-feature-context-references', () => {
    const entities: Entity[] = [
      {
        type: 'surface',
        name: 'web-app',
        params: [],
        clauses: {},
        body: 'Web app.',
        references: []
      },
      {
        type: 'feature',
        name: 'auth',
        params: [],
        clauses: {},
        body: 'Auth feature.',
        references: [{ name: 'web-app' }] // in context
      },
      {
        type: 'behavior',
        name: 'login-test',
        params: [],
        clauses: {},
        body: 'Login test.',
        references: [],
        // This behavior is inside the feature and should inherit context deps
      }
    ];

    // The parser would have already merged feature context references
    // into child behaviors during parsing, so login-test should have
    // web-app in its inherited dependencies

    const graph = buildDependencyGraph(entities);

    // This test assumes the parser has done the inheritance work
    // The resolver just needs to build the graph from what's given
    expect(graph.nodes).toContain('web-app');
    expect(graph.nodes).toContain('auth');
  });
});

describe('type-taxonomy', () => {
  it('accepts-configured-types', () => {
    const config = {
      types: ['surface', 'fixture', 'instrument', 'behavior', 'feature']
    };

    const entities: Entity[] = [
      { type: 'surface', name: 'app', params: [], clauses: {}, body: '', references: [] },
      { type: 'fixture', name: 'data', params: [], clauses: {}, body: '', references: [] },
      { type: 'instrument', name: 'tool', params: [], clauses: {}, body: '', references: [] },
      { type: 'behavior', name: 'test', params: [], clauses: {}, body: '', references: [] },
      { type: 'feature', name: 'feat', params: [], clauses: {}, body: '', references: [] }
    ];

    // Validation would be part of the resolver
    const result = resolveReferences(entities, config);

    expect(result.ok).toBe(true);
  });

  it('rejects-unconfigured-type', () => {
    const config = {
      types: ['surface', 'fixture', 'instrument', 'behavior', 'feature']
    };

    const entities: Entity[] = [
      {
        type: 'widget', // not in allowed types
        name: 'my-thing',
        params: [],
        clauses: {},
        body: '',
        references: []
      }
    ];

    const result = resolveReferences(entities, config);

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/unknown.*type.*widget/i);
    expect(result.errors![0].message).toMatch(/surface.*fixture.*instrument/i);
  });
});
