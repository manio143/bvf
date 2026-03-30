import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
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

    // Check bvf.config exists and has correct content
    const configPath = join(tmpDir, 'bvf.config');
    expect(existsSync(configPath)).toBe(true);
    const configContent = readFileSync(configPath, 'utf-8');
    expect(configContent).toContain('types: surface, fixture, instrument, behavior, feature');
    expect(configContent).toContain('containment:');
    expect(configContent).toContain('feature: behavior');
    expect(configContent).toContain('file-extension: .bvf');
    expect(configContent).toContain('state-dir: .bvf-state');

    // Check specs/ directory exists
    const specsPath = join(tmpDir, 'specs');
    expect(existsSync(specsPath)).toBe(true);

    // Check .bvf-state/ directory exists
    const statePath = join(tmpDir, '.bvf-state');
    expect(existsSync(statePath)).toBe(true);
  });

  it('init-refuses-existing-project', async () => {
    // Create existing bvf.config
    const configPath = join(tmpDir, 'bvf.config');
    writeFileSync(configPath, `#config
  types: surface
#end`);

    const result = await runCli('init', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('already initialized');
  });
});
