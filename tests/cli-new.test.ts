import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

// Helper to run CLI commands
async function runCli(args: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${join(__dirname, '../dist/cli.js')} ${args}`, { cwd });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.code || 1
    };
  }
}

describe('cli-exit-codes', { timeout: 30000 }, () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'bvf-exit-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('exit-zero-on-success-or-informational', async () => {
    // Setup: Create a valid project with stale and pending entities
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl surface web-app
  A web application.
#end

#decl behavior login-test
  Test login.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    // Create manifest with one stale entry (old hash) and one missing (pending)
    const manifest = {
      'web-app': {
        name: 'web-app',
        specHash: 'old-hash-different',
        dependencyHash: 'old-hash-different',
        artifact: 'tests/web-app.spec.ts',
        materializedAt: new Date().toISOString()
      }
      // login-test is not in manifest, so it's pending:new
    };

    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Run resolve - should exit 0 even with stale and pending
    const result = await runCli('resolve', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Stale: 1/);
    expect(result.stdout).toMatch(/Pending: 1/);

    // Also test list with no matches - should exit 0
    const listResult = await runCli('list fixture', projectDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toMatch(/No entities of type 'fixture' found/i);

    // Test successful init
    const emptyDir = mkdtempSync(join(tmpdir(), 'bvf-init-zero-'));
    const initResult = await runCli('init', emptyDir);
    expect(initResult.exitCode).toBe(0);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('exit-one-on-error', async () => {
    // Test 1: resolve with unresolved references
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'broken.bvf'), `
#decl behavior test-behavior
  Uses @{nonexistent-entity}.
#end
    `);

    mkdirSync(join(projectDir, '.bvf-state'));

    const resolveResult = await runCli('resolve', projectDir);
    expect(resolveResult.exitCode).toBe(1);
    expect(resolveResult.stderr).toMatch(/nonexistent-entity/);

    // Test 2: init on already-initialized project
    const existingDir = mkdtempSync(join(tmpdir(), 'bvf-existing-'));
    writeFileSync(join(existingDir, 'bvf.config'), '#config\n  types: surface\n#end\n');
    
    const initResult = await runCli('init', existingDir);
    expect(initResult.exitCode).toBe(1);
    expect(initResult.stderr).toMatch(/already initialized/i);
    
    rmSync(existingDir, { recursive: true, force: true });

    // Note: mark command tests will be added once mark is implemented
    // Test 3: mark on nonexistent entity would also be exit 1
  });
});

describe('cli-resolve-extended', { timeout: 30000 }, () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'bvf-resolve-ext-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('resolve-with-pending-entities', async () => {
    // Setup: Create project with entities that have never been materialized
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, instrument, behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl surface web-app
  A web application.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end

#decl behavior can-login using @{login}
  User can login.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    // Empty manifest - all entities are new/pending
    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify({}, null, 2));

    const result = await runCli('resolve', projectDir);

    expect(result.exitCode).toBe(0); // Pending is informational, not error
    expect(result.stdout).toMatch(/⏳.*web-app/); // Pending symbol
    expect(result.stdout).toMatch(/⏳.*login/);
    expect(result.stdout).toMatch(/⏳.*can-login/);
    expect(result.stdout).toMatch(/Pending: 3/);
    expect(result.stdout).toMatch(/Current: 0/);
    expect(result.stdout).toMatch(/Errors: 0/);
  });

  it('resolve-mixed-statuses', async () => {
    // Setup: Create project with current, stale, and pending entities
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, behavior, feature
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    // Create two features: one clean, one with issues
    writeFileSync(join(specsDir, 'auth.bvf'), `
#decl feature auth-feature
  Authentication feature.

  #behavior login-test
    Test login.
  #end

  #behavior logout-test
    Test logout.
  #end
#end
    `);

    writeFileSync(join(specsDir, 'data.bvf'), `
#decl feature data-feature
  Data management feature.

  #behavior save-test
    Test saving data.
  #end
#end
    `);

    writeFileSync(join(specsDir, 'standalone.bvf'), `
#decl surface web-app
  A web application.
#end

#decl behavior standalone-test
  A standalone behavior.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    // Parse entities to get real hashes
    const { parseBvfFile } = await import('../src/parser');
    const { resolveReferences } = await import('../src/resolver');
    const { parseConfig } = await import('../src/config');
    const { computeSpecHash, computeDependencyHash } = await import('../src/manifest');

    const config = parseConfig(readFileSync(join(projectDir, 'bvf.config'), 'utf-8')).value!;
    
    const authContent = readFileSync(join(specsDir, 'auth.bvf'), 'utf-8');
    const dataContent = readFileSync(join(specsDir, 'data.bvf'), 'utf-8');
    const standaloneContent = readFileSync(join(specsDir, 'standalone.bvf'), 'utf-8');

    const authParsed = parseBvfFile(authContent).value!;
    const dataParsed = parseBvfFile(dataContent).value!;
    const standaloneParsed = parseBvfFile(standaloneContent).value!;

    const allEntities = [...authParsed, ...dataParsed, ...standaloneParsed];
    const resolved = resolveReferences(allEntities, config).value!;

    const entityHashes = new Map<string, string>();
    for (const entity of resolved) {
      entityHashes.set(entity.name, computeSpecHash(entity));
    }

    // Build manifest with mixed statuses:
    // - web-app: current (correct hash)
    // - login-test: stale (old hash)
    // - logout-test: not in manifest (pending)
    // - save-test: current (correct hash)
    // - standalone-test: not in manifest (pending)

    const webApp = resolved.find(e => e.name === 'web-app')!;
    const loginTest = resolved.find(e => e.name === 'login-test')!;
    const saveTest = resolved.find(e => e.name === 'save-test')!;

    const manifest = {
      'web-app': {
        name: 'web-app',
        specHash: computeSpecHash(webApp),
        dependencyHash: computeDependencyHash(webApp, entityHashes),
        artifact: 'tests/web-app.spec.ts',
        materializedAt: new Date().toISOString()
      },
      'login-test': {
        name: 'login-test',
        specHash: 'old-hash-stale',
        dependencyHash: computeDependencyHash(loginTest, entityHashes),
        artifact: 'tests/login-test.spec.ts',
        materializedAt: new Date().toISOString()
      },
      'save-test': {
        name: 'save-test',
        specHash: computeSpecHash(saveTest),
        dependencyHash: computeDependencyHash(saveTest, entityHashes),
        artifact: 'tests/save-test.spec.ts',
        materializedAt: new Date().toISOString()
      }
    };

    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const result = await runCli('resolve', projectDir);

    expect(result.exitCode).toBe(0);

    // Check for mixed status symbols
    expect(result.stdout).toMatch(/✓.*web-app/); // current
    expect(result.stdout).toMatch(/✓.*save-test/); // current
    expect(result.stdout).toMatch(/✗.*login-test/); // stale
    expect(result.stdout).toMatch(/⏳.*logout-test/); // pending
    expect(result.stdout).toMatch(/⏳.*standalone-test/); // pending

    // Check summary counts
    expect(result.stdout).toMatch(/Current: 2/);
    expect(result.stdout).toMatch(/Stale: 1/);
    expect(result.stdout).toMatch(/Pending: 2/);
    expect(result.stdout).toMatch(/Errors: 0/);

    // Features with problems should be pushed to end (spec says alphabetically
    // among themselves). Here auth-feature has stale/pending, data-feature is clean.
    // Output should show clean features first, then problematic ones.
    const authIndex = result.stdout.indexOf('auth-feature');
    const dataIndex = result.stdout.indexOf('data-feature');
    
    // data-feature (clean) should appear before auth-feature (has issues)
    expect(dataIndex).toBeLessThan(authIndex);
  });
});

describe('cli-mark', { timeout: 30000 }, () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'bvf-mark-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  // Note: These tests describe EXPECTED behavior for the mark command.
  // The mark command is not yet implemented in cli.ts, so these tests
  // will fail until the implementation is added.

  it('mark-needs-elaboration', async () => {
    // Setup: Create project with entity that exists
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl behavior password-reset
  Reset password flow.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify({}, null, 2));

    // Run mark command with needs-elaboration status
    const result = await runCli(
      'mark password-reset needs-elaboration --note "needs instrument defining reset steps"',
      projectDir
    );

    expect(result.exitCode).toBe(0);

    // Verify manifest was updated
    const manifest = JSON.parse(readFileSync(join(stateDir, 'manifest.json'), 'utf-8'));
    expect(manifest['password-reset']).toBeDefined();
    expect(manifest['password-reset'].status).toBe('pending');
    expect(manifest['password-reset'].reason).toBe('needs-elaboration');
    expect(manifest['password-reset'].note).toBe('needs instrument defining reset steps');

    // Run resolve to see the status reflected
    const resolveResult = await runCli('resolve', projectDir);
    expect(resolveResult.stdout).toMatch(/⏳.*password-reset/);
    expect(resolveResult.stdout).toMatch(/needs-elaboration/);
    expect(resolveResult.stdout).toMatch(/needs instrument defining reset steps/);
  });

  it('mark-review-failed', async () => {
    // Setup: Create project with entity that's currently marked as current
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl behavior login-test
  Test login functionality.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    // Parse to get real hash
    const { parseBvfFile } = await import('../src/parser');
    const { computeSpecHash } = await import('../src/manifest');
    
    const content = readFileSync(join(specsDir, 'test.bvf'), 'utf-8');
    const parsed = parseBvfFile(content).value!;
    const entity = parsed[0];
    const hash = computeSpecHash(entity);

    const manifest = {
      'login-test': {
        name: 'login-test',
        specHash: hash,
        dependencyHash: hash,
        artifact: 'tests/login-test.spec.ts',
        materializedAt: new Date().toISOString()
      }
    };

    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Verify it's currently marked as current
    let resolveResult = await runCli('resolve', projectDir);
    expect(resolveResult.stdout).toMatch(/✓.*login-test/);

    // Mark as review-failed
    const markResult = await runCli(
      'mark login-test review-failed --note "test uses fake hashes"',
      projectDir
    );

    expect(markResult.exitCode).toBe(0);

    // Verify manifest was updated to stale with review-failed reason
    const updatedManifest = JSON.parse(readFileSync(join(stateDir, 'manifest.json'), 'utf-8'));
    expect(updatedManifest['login-test']).toBeDefined();
    expect(updatedManifest['login-test'].status).toBe('stale');
    expect(updatedManifest['login-test'].reason).toBe('review-failed');
    expect(updatedManifest['login-test'].note).toBe('test uses fake hashes');

    // Run resolve to see stale status
    resolveResult = await runCli('resolve', projectDir);
    expect(resolveResult.stdout).toMatch(/✗.*login-test/);
    expect(resolveResult.stdout).toMatch(/review-failed/);
    expect(resolveResult.stdout).toMatch(/test uses fake hashes/);
  });

  it('mark-nonexistent-entity', async () => {
    // Setup: Create valid project
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl behavior existing-test
  This exists.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify({}, null, 2));

    // Try to mark entity that doesn't exist
    const result = await runCli('mark nonexistent-entity review-failed', projectDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/nonexistent-entity.*not found/i);
  });
});
