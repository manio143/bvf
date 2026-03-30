import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
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

describe('cli-init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init-creates-project', async () => {
    const result = await runCli('init', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created bvf.config');
    expect(result.stdout).toContain('Created specs/');
    expect(result.stdout).toContain('Created .bvf-state/');
    
    // Verify files were created
    expect(existsSync(join(tmpDir, 'bvf.config'))).toBe(true);
    expect(existsSync(join(tmpDir, 'specs'))).toBe(true);
    expect(existsSync(join(tmpDir, '.bvf-state'))).toBe(true);
  });

  it('init-refuses-existing-project', async () => {
    // Create a bvf.config first
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  types: surface
  file-extension: .bvf
  state-dir: .bvf-state
#end`);

    const result = await runCli('init', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('already initialized');
  });
});
