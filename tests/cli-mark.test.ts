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

  it('mark-needs-elaboration', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior password-reset
    Test reset flow.
  #end
#end
`
    });

    createManifest(tmpDir, {});

    const markResult = await runCli('mark password-reset needs-elaboration --note "needs instrument defining reset steps"', tmpDir);

    expect(markResult.exitCode).toBe(0);

    // Verify manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifestContent['password-reset']).toBeDefined();
    expect(manifestContent['password-reset'].status).toBe('pending');
    expect(manifestContent['password-reset'].reason).toBe('needs-elaboration');
    expect(manifestContent['password-reset'].note).toBe('needs instrument defining reset steps');

    // Verify resolve shows the status
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('password-reset');
    expect(resolveResult.stdout.toLowerCase()).toContain('elaboration');
    expect(resolveResult.stdout).toContain('reset steps');
  });

  it('mark-review-failed', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
`
    });

    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update('login-test').digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('dep').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'current',
        specHash: hash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      }
    });

    const markResult = await runCli('mark login-test review-failed --note "test uses fake hashes"', tmpDir);

    expect(markResult.exitCode).toBe(0);

    // Verify manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifestContent['login-test']).toBeDefined();
    expect(manifestContent['login-test'].status).toBe('stale');
    expect(manifestContent['login-test'].reason).toBe('review-failed');
    expect(manifestContent['login-test'].note).toBe('test uses fake hashes');

    // Verify resolve shows the status
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('✗');
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout.toLowerCase()).toContain('review-failed');
    expect(resolveResult.stdout).toContain('fake hashes');
  });

  it('mark-nonexistent-entity', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end
`
    });

    createManifest(tmpDir, {});

    const result = await runCli('mark nonexistent review-failed --note "test note"', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('nonexistent');
    expect(result.stderr.toLowerCase()).toContain('not found');
  });

  it('mark-current-with-artifact', async () => {
    const specContent = `#decl surface my-surface
  Test surface.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login behavior.
  #end
#end
`;
    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    createManifest(tmpDir, {});

    // Mark entity as current with artifact
    const markResult = await runCli('mark login-test current --artifact "tests/login.test.ts"', tmpDir);

    expect(markResult.exitCode).toBe(0);

    // Verify manifest was updated with real hashes
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    
    expect(manifestContent['login-test']).toBeDefined();
    expect(manifestContent['login-test'].artifact).toBe('tests/login.test.ts');
    expect(manifestContent['login-test'].specHash).toBeDefined();
    expect(manifestContent['login-test'].specHash.length).toBeGreaterThan(0);
    expect(manifestContent['login-test'].dependencyHash).toBeDefined();
    expect(manifestContent['login-test'].dependencyHash.length).toBeGreaterThan(0);

    // Subsequent resolve should show entity as current
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('✓');
    expect(resolveResult.stdout).toContain('login-test');
  });

  it('mark-current-requires-artifact', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login behavior.
  #end
#end
`
    });

    createManifest(tmpDir, {});

    // Try to mark as current without --artifact flag
    const result = await runCli('mark login-test current', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('artifact');
    expect(result.stderr.toLowerCase()).toContain('required');
  });

  it('mark-current-updates-stale-entity', async () => {
    const newSpecContent = `#decl surface my-surface
  Test surface.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Updated test content with changes.
  #end
#end
`;

    // Set up project with current spec content
    setupProject(tmpDir, {
      'test.bvf': newSpecContent
    });

    // Create manifest with stale status to simulate:
    // "entity was current with old content, then spec changed"
    // Using status override instead of manually computed hashes
    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'stale',
        reason: 'content-changed',
        artifact: 'tests/login.test.ts',
        specHash: 'old-content-hash',
        dependencyHash: 'old-dep-hash',
        materializedAt: new Date(Date.now() - 10000).toISOString()
      }
    });

    // Verify entity shows as stale before marking
    const resolveBeforeResult = await runCli('resolve', tmpDir);
    expect(resolveBeforeResult.exitCode).toBe(0);
    expect(resolveBeforeResult.stdout).toContain('✗');
    expect(resolveBeforeResult.stdout).toContain('login-test');

    // Mark entity as current with artifact
    // This should compute real hashes from current spec content and clear status override
    const markResult = await runCli('mark login-test current --artifact "tests/login.test.ts"', tmpDir);

    expect(markResult.exitCode).toBe(0);

    // Verify manifest was updated with real computed hashes
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    
    expect(manifestContent['login-test']).toBeDefined();
    expect(manifestContent['login-test'].specHash).not.toBe('old-content-hash');
    expect(manifestContent['login-test'].specHash.length).toBeGreaterThan(0);
    expect(manifestContent['login-test'].artifact).toBe('tests/login.test.ts');
    // Status override should be cleared (no explicit status field)
    expect(manifestContent['login-test'].status).toBeUndefined();

    // Subsequent resolve should show entity as current
    const resolveAfterResult = await runCli('resolve', tmpDir);
    expect(resolveAfterResult.exitCode).toBe(0);
    expect(resolveAfterResult.stdout).toContain('✓');
    expect(resolveAfterResult.stdout).toContain('login-test');
  });
});
