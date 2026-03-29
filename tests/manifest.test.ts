import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  loadManifest, 
  saveManifest, 
  computeSpecHash,
  computeDependencyHash,
  getEntityStatus,
  recordMaterialization
} from '../src/manifest.js';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

// Type definitions
interface Entity {
  type: string;
  name: string;
  body: string;
  dependencies: string[];
  transitiveDependencies: string[];
}

interface ManifestEntry {
  name: string;
  specHash: string;
  dependencyHash: string;
  artifact?: string;
  materializedAt?: string;
}

interface Manifest {
  entries: Map<string, ManifestEntry>;
}

interface EntityStatus {
  name: string;
  status: 'pending' | 'current' | 'stale' | 'orphaned';
  reason?: string;
}

describe('materialization-state', () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
    stateDir = join(tempDir, '.bvf-state');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('new-entity-is-pending', () => {
    const entity: Entity = {
      type: 'behavior',
      name: 'login-test',
      body: 'Test login functionality.',
      dependencies: [],
      transitiveDependencies: []
    };

    const manifest: Manifest = { entries: new Map() };
    const status = getEntityStatus(entity, manifest);

    expect(status.status).toBe('pending');
    expect(status.name).toBe('login-test');
  });

  it('unchanged-entity-stays-current', () => {
    const entity: Entity = {
      type: 'behavior',
      name: 'login-test',
      body: 'Test login functionality.',
      dependencies: ['web-app'],
      transitiveDependencies: ['web-app']
    };

    const specHash = computeSpecHash(entity);
    const depHash = computeDependencyHash(entity, new Map([
      ['web-app', 'hash-web-app']
    ]));

    const manifest: Manifest = {
      entries: new Map([
        ['login-test', {
          name: 'login-test',
          specHash,
          dependencyHash: depHash,
          artifact: 'tests/login-test.spec.ts',
          materializedAt: new Date().toISOString()
        }]
      ])
    };

    const status = getEntityStatus(entity, manifest);

    expect(status.status).toBe('current');
  });

  it('content-change-makes-entity-stale', () => {
    const originalBody = 'Test login functionality.';
    const changedBody = 'Test login functionality with extra validation.';

    const entity: Entity = {
      type: 'behavior',
      name: 'login-test',
      body: changedBody,
      dependencies: [],
      transitiveDependencies: []
    };

    const oldEntity: Entity = {
      ...entity,
      body: originalBody
    };

    const oldHash = computeSpecHash(oldEntity);
    const oldDepHash = computeDependencyHash(oldEntity, new Map());

    const manifest: Manifest = {
      entries: new Map([
        ['login-test', {
          name: 'login-test',
          specHash: oldHash,
          dependencyHash: oldDepHash,
          artifact: 'tests/login-test.spec.ts',
          materializedAt: new Date().toISOString()
        }]
      ])
    };

    const status = getEntityStatus(entity, manifest);

    expect(status.status).toBe('stale');
    expect(status.reason).toMatch(/content.*changed/i);
  });

  it('dependency-change-makes-entity-stale', () => {
    const loginEntity: Entity = {
      type: 'instrument',
      name: 'login',
      body: 'Login instrument - CHANGED.',
      dependencies: [],
      transitiveDependencies: []
    };

    const canLoginEntity: Entity = {
      type: 'behavior',
      name: 'can-login',
      body: 'Test that user can login.',
      dependencies: ['login'],
      transitiveDependencies: ['login']
    };

    // Old state: login had different content
    const oldLoginHash = 'old-login-hash';
    const newLoginHash = computeSpecHash(loginEntity);

    // can-login was materialized when login had old hash
    const oldDepHash = computeDependencyHash(canLoginEntity, new Map([
      ['login', oldLoginHash]
    ]));

    const manifest: Manifest = {
      entries: new Map([
        ['login', {
          name: 'login',
          specHash: oldLoginHash,
          dependencyHash: oldLoginHash,
          artifact: 'tests/login.spec.ts'
        }],
        ['can-login', {
          name: 'can-login',
          specHash: computeSpecHash(canLoginEntity),
          dependencyHash: oldDepHash,
          artifact: 'tests/can-login.spec.ts'
        }]
      ])
    };

    const status = getEntityStatus(canLoginEntity, manifest, new Map([
      ['login', newLoginHash]
    ]));

    expect(status.status).toBe('stale');
    expect(status.reason).toMatch(/dependency.*login.*changed/i);
  });

  it('transitive-dependency-change-propagates', () => {
    const webApp: Entity = {
      type: 'surface',
      name: 'web-app',
      body: 'Web application - CHANGED.',
      dependencies: [],
      transitiveDependencies: []
    };

    const login: Entity = {
      type: 'instrument',
      name: 'login',
      body: 'Login instrument.',
      dependencies: ['web-app'],
      transitiveDependencies: ['web-app']
    };

    const canLogin: Entity = {
      type: 'behavior',
      name: 'can-login',
      body: 'Test login.',
      dependencies: ['login'],
      transitiveDependencies: ['login', 'web-app']
    };

    // Old state
    const oldWebAppHash = 'old-web-app-hash';
    const newWebAppHash = computeSpecHash(webApp);
    const loginHash = computeSpecHash(login);
    const canLoginHash = computeSpecHash(canLogin);

    const oldLoginDepHash = computeDependencyHash(login, new Map([
      ['web-app', oldWebAppHash]
    ]));

    const oldCanLoginDepHash = computeDependencyHash(canLogin, new Map([
      ['login', loginHash],
      ['web-app', oldWebAppHash]
    ]));

    const manifest: Manifest = {
      entries: new Map([
        ['web-app', { name: 'web-app', specHash: oldWebAppHash, dependencyHash: oldWebAppHash, artifact: 'tests/web-app.spec.ts' }],
        ['login', { name: 'login', specHash: loginHash, dependencyHash: oldLoginDepHash, artifact: 'tests/login.spec.ts' }],
        ['can-login', { name: 'can-login', specHash: canLoginHash, dependencyHash: oldCanLoginDepHash, artifact: 'tests/can-login.spec.ts' }]
      ])
    };

    const currentHashes = new Map([
      ['web-app', newWebAppHash],
      ['login', loginHash],
      ['can-login', canLoginHash]
    ]);

    const loginStatus = getEntityStatus(login, manifest, currentHashes);
    const canLoginStatus = getEntityStatus(canLogin, manifest, currentHashes);

    expect(loginStatus.status).toBe('stale');
    expect(loginStatus.reason).toMatch(/dependency.*web-app.*changed/i);

    expect(canLoginStatus.status).toBe('stale');
    expect(canLoginStatus.reason).toMatch(/dependency.*login.*changed/i);
  });

  it('records-materialization', () => {
    const entity: Entity = {
      type: 'behavior',
      name: 'login-test',
      body: 'Test login.',
      dependencies: [],
      transitiveDependencies: []
    };

    const manifest: Manifest = { entries: new Map() };
    
    const specHash = computeSpecHash(entity);
    const depHash = computeDependencyHash(entity, new Map());

    const updated = recordMaterialization(
      manifest,
      'login-test',
      'tests/login-test.spec.ts',
      specHash,
      depHash
    );

    expect(updated.entries.has('login-test')).toBe(true);
    const entry = updated.entries.get('login-test')!;
    
    expect(entry.name).toBe('login-test');
    expect(entry.specHash).toBe(specHash);
    expect(entry.dependencyHash).toBe(depHash);
    expect(entry.artifact).toBe('tests/login-test.spec.ts');
    expect(entry.materializedAt).toBeDefined();
  });

  it('removed-entity-is-detected', () => {
    const manifest: Manifest = {
      entries: new Map([
        ['old-test', {
          name: 'old-test',
          specHash: 'hash-abc',
          dependencyHash: 'hash-def',
          artifact: 'tests/old-test.spec.ts',
          materializedAt: new Date().toISOString()
        }]
      ])
    };

    // Current entities don't include 'old-test'
    const currentEntities: Entity[] = [];

    const orphaned = findOrphanedEntries(manifest, currentEntities);

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toBe('old-test');
  });
});

describe('hash-computation', () => {
  it('spec-hash-from-content', () => {
    const entity: Entity = {
      type: 'behavior',
      name: 'login-test',
      body: 'Test login functionality.\n',
      dependencies: [],
      transitiveDependencies: []
    };

    const hash1 = computeSpecHash(entity);
    const hash2 = computeSpecHash(entity);

    // Hash should be deterministic
    expect(hash1).toBe(hash2);

    // Different content = different hash
    const differentEntity: Entity = {
      ...entity,
      body: 'Different test content.\n'
    };
    const hash3 = computeSpecHash(differentEntity);

    expect(hash3).not.toBe(hash1);
  });

  it('dependency-hash-includes-transitive', () => {
    const entity: Entity = {
      type: 'behavior',
      name: 'can-login',
      body: 'Test login.',
      dependencies: ['login'],
      transitiveDependencies: ['login', 'web-app']
    };

    const entityHashes = new Map([
      ['login', 'hash-login-abc'],
      ['web-app', 'hash-web-app-xyz'],
      ['can-login', 'hash-can-login-123']
    ]);

    const depHash = computeDependencyHash(entity, entityHashes);

    // Dependency hash should incorporate all transitive deps
    expect(depHash).toBeDefined();
    expect(depHash.length).toBeGreaterThan(0);

    // Changing a transitive dep should change the hash
    const differentHashes = new Map([
      ['login', 'hash-login-abc'],
      ['web-app', 'hash-web-app-DIFFERENT'],
      ['can-login', 'hash-can-login-123']
    ]);

    const differentDepHash = computeDependencyHash(entity, differentHashes);
    expect(differentDepHash).not.toBe(depHash);
  });

  it('dependency-hash-changes-when-dep-changes', () => {
    const entity: Entity = {
      type: 'behavior',
      name: 'can-login',
      body: 'Test login.',
      dependencies: ['login'],
      transitiveDependencies: ['login', 'web-app']
    };

    const originalHashes = new Map([
      ['login', 'hash-login-original'],
      ['web-app', 'hash-web-app-original']
    ]);

    const changedHashes = new Map([
      ['login', 'hash-login-CHANGED'],
      ['web-app', 'hash-web-app-original']
    ]);

    const hash1 = computeDependencyHash(entity, originalHashes);
    const hash2 = computeDependencyHash(entity, changedHashes);

    expect(hash2).not.toBe(hash1);
  });
});

// Helper function that would be in the implementation
function findOrphanedEntries(manifest: Manifest, currentEntities: Entity[]): string[] {
  const currentNames = new Set(currentEntities.map(e => e.name));
  const orphaned: string[] = [];

  for (const [name, entry] of manifest.entries) {
    if (!currentNames.has(name)) {
      orphaned.push(name);
    }
  }

  return orphaned;
}
