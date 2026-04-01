import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);
const CLI = join(__dirname, '../dist/cli.js');

async function runCli(args: string, cwd: string) {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI} ${args}`, { cwd });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.code || 1 };
  }
}

function setupProject(dir: string, files: Record<string, string>, config?: string) {
  mkdirSync(join(dir, 'specs'), { recursive: true });
  mkdirSync(join(dir, '.bvf-state'), { recursive: true });
  const defaultConfigContent = config || `#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end`;
  writeFileSync(join(dir, 'bvf.config'), defaultConfigContent);
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, 'specs', name);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content);
  }
}

function createManifest(dir: string, entries: Record<string, any>) {
  const manifestPath = join(dir, '.bvf-state', 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(entries, null, 2));
}

describe('cli-mark', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mark-spec-needs-elaboration', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior password-reset
  Test password reset behavior.
#end
`
    });

    // Initialize with resolve to create baseline manifest
    await runCli('resolve', tmpDir);

    const result = await runCli('mark password-reset spec-needs-elaboration --note "needs instrument defining reset steps"', tmpDir);

    expect(result.exitCode).toBe(0);

    // Check manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest['password-reset']).toBeDefined();
    expect(manifest['password-reset'].status).toBe('pending');
    expect(manifest['password-reset'].reason).toBe('needs-elaboration');
    expect(manifest['password-reset'].note).toBe('needs instrument defining reset steps');

    // Verify resolve shows the status
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.stdout).toContain('password-reset');
    expect(resolveResult.stdout).toContain('[needs-elaboration]');
  });

  it('mark-spec-reviewed', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior password-reset
  Test password reset behavior.
#end
`
    });

    // Initialize with resolve
    await runCli('resolve', tmpDir);

    const result = await runCli('mark password-reset spec-reviewed', tmpDir);

    expect(result.exitCode).toBe(0);

    // Check manifest was updated with hashes
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest['password-reset']).toBeDefined();
    expect(manifest['password-reset'].status).toBe('pending');
    expect(manifest['password-reset'].reason).toBe('reviewed');
    expect(manifest['password-reset'].specHash).toBeDefined();
    expect(manifest['password-reset'].specHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(manifest['password-reset'].dependencyHash).toBeDefined();

    // Verify resolve shows ready for materialization
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.stdout).toContain('password-reset');
    expect(resolveResult.stdout).toContain('[reviewed]');
  });

  it('mark-test-ready', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test login behavior.
#end
`
    });

    // Initialize and mark as spec-reviewed
    await runCli('resolve', tmpDir);
    await runCli('mark login-test spec-reviewed', tmpDir);

    const result = await runCli('mark login-test test-ready --artifact "tests/login.test.ts"', tmpDir);

    expect(result.exitCode).toBe(0);

    // Check manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('current');
    expect(manifest['login-test'].reason).toBe('needs-review');
    expect(manifest['login-test'].specHash).toBeDefined();
    expect(manifest['login-test'].dependencyHash).toBeDefined();
    expect(manifest['login-test'].artifact).toBe('tests/login.test.ts');
    expect(manifest['login-test'].materializedAt).toBeDefined();

    // Verify resolve shows awaiting alignment review
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout).toContain('[needs-review]');
  });

  it('mark-test-ready-requires-artifact', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test login behavior.
#end
`
    });

    // Initialize and mark as spec-reviewed
    await runCli('resolve', tmpDir);
    await runCli('mark login-test spec-reviewed', tmpDir);

    const result = await runCli('mark login-test test-ready', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('artifact');
    expect(result.stderr.toLowerCase()).toMatch(/test-ready|requires/);
  });

  it('mark-test-reviewed', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test login behavior.
#end
`
    });

    // Initialize, mark as spec-reviewed, then test-ready
    await runCli('resolve', tmpDir);
    await runCli('mark login-test spec-reviewed', tmpDir);
    await runCli('mark login-test test-ready --artifact "tests/login.test.ts"', tmpDir);

    const result = await runCli('mark login-test test-reviewed', tmpDir);

    expect(result.exitCode).toBe(0);

    // Check manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('current');
    expect(manifest['login-test'].reason).toBe('reviewed');

    // Verify resolve shows fully validated
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout).toContain('[reviewed]');
  });

  it('mark-test-needs-fixing', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test login behavior.
#end
`
    });

    // Initialize, mark as spec-reviewed, then test-ready
    await runCli('resolve', tmpDir);
    await runCli('mark login-test spec-reviewed', tmpDir);
    await runCli('mark login-test test-ready --artifact "tests/login.test.ts"', tmpDir);

    const result = await runCli('mark login-test test-needs-fixing --note "test uses hardcoded values"', tmpDir);

    expect(result.exitCode).toBe(0);

    // Check manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('reviewed');
    expect(manifest['login-test'].note).toBe('test uses hardcoded values');
    expect(manifest['login-test'].artifact).toBe('tests/login.test.ts'); // Preserved

    // Verify resolve shows needs fixing
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout).toContain('[reviewed]');
  });

  it('mark-nonexistent-entity', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end
`
    });

    createManifest(tmpDir, {});

    const result = await runCli('mark nonexistent spec-reviewed --note "test note"', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('nonexistent');
    expect(result.stderr.toLowerCase()).toContain('not found');
  });

  it('mark-updates-hashes-on-transition', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Original content.
#end
`
    });

    // Initialize and mark as needs-elaboration
    await runCli('resolve', tmpDir);
    await runCli('mark login-test spec-needs-elaboration --note "needs work"', tmpDir);

    // Get the original hash
    let manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    let manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const originalHash = manifest['login-test'].specHash;

    // Edit the spec
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), `#decl behavior login-test
  Updated content with changes.
#end
`);

    // Run resolve to update manifest with new hash (natural workflow)
    await runCli('resolve', tmpDir);

    // Mark as spec-reviewed (should update hashes and reason)
    const result = await runCli('mark login-test spec-reviewed', tmpDir);

    expect(result.exitCode).toBe(0);

    // Check that hashes were updated
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['login-test'].specHash).toBeDefined();
    expect(manifest['login-test'].specHash).not.toBe(originalHash); // Hash changed
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('reviewed');
  });

  it('mark-detects-stale-before-blessing', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior auth-test
  Original content.
#end
`
    });

    // Initialize and mark as spec-needs-elaboration (as spec requires)
    await runCli('resolve', tmpDir);
    await runCli('mark auth-test spec-needs-elaboration --note "needs clarification"', tmpDir);

    // Get the original hash
    let manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    let manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const originalHash = manifest['auth-test'].specHash;

    // Edit the spec (without running resolve)
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), `#decl behavior auth-test
  Modified content.
#end
`);

    // Try to mark as spec-reviewed again without resolve (should fail)
    const result = await runCli('mark auth-test spec-reviewed', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toMatch(/changed|stale|resolve/);
    expect(result.stderr.toLowerCase()).toContain('error');

    // Try with --force flag (should succeed)
    const forceResult = await runCli('mark auth-test spec-reviewed --force', tmpDir);
    expect(forceResult.exitCode).toBe(0);

    // Verify hashes were updated
    manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['auth-test'].status).toBe('pending');
    expect(manifest['auth-test'].reason).toBe('reviewed');
    expect(manifest['auth-test'].specHash).not.toBe(originalHash);
  });

  it('mark-rejects-invalid-state-transition', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior auth-test
  Test behavior.
#end
`
    });

    // Initialize (creates manifest with no review state)
    await runCli('resolve', tmpDir);

    // Try to mark as test-ready without spec-reviewed first
    const result = await runCli('mark auth-test test-ready --artifact "tests/auth.test.ts"', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toMatch(/cannot|error/);
    expect(result.stderr.toLowerCase()).toMatch(/test-ready|spec-reviewed|review/);
  });

});
