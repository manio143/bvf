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
      'test.bvf': `#decl behavior password-reset
  Test.
#end
`
    });

    const result = await runCli('mark password-reset needs-elaboration --note "needs instrument defining reset steps"', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('password-reset');
    expect(result.stdout).toContain('pending');
    expect(result.stdout).toContain('needs-elaboration');
    expect(result.stdout).toContain('needs instrument defining reset steps');
    
    // Verify manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    
    expect(manifest['password-reset']).toBeDefined();
    expect(manifest['password-reset'].status).toBe('pending');
    expect(manifest['password-reset'].reason).toBe('needs-elaboration');
    expect(manifest['password-reset'].note).toContain('reset steps');
  });

  it('mark-review-failed', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test.
#end
`
    });

    const result = await runCli('mark login-test review-failed --note "test uses fake hashes"', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('login-test');
    expect(result.stdout).toContain('stale');
    expect(result.stdout).toContain('review-failed');
    expect(result.stdout).toContain('fake hashes');
    
    // Verify manifest was updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    
    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('stale');
    expect(manifest['login-test'].reason).toBe('review-failed');
    expect(manifest['login-test'].note).toContain('fake hashes');
  });

  it('mark-nonexistent-entity', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior existing-test
  Test.
#end
`
    });

    const result = await runCli('mark nonexistent needs-elaboration', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('nonexistent');
    expect(result.stderr.toLowerCase()).toContain('not found');
  });
});
