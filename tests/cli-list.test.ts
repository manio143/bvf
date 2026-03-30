import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
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

describe('cli-list', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('list-all-entities', async () => {
    setupProject(tmpDir, {
      'file1.bvf': `#decl surface web-app
  Surface one.
#end

#decl fixture user
  Fixture one.
#end
`,
      'file2.bvf': `#decl surface api
  Surface two.
#end

#decl instrument login on @{web-app}
  Instrument one.
#end

#decl feature auth on @{web-app}
  #decl behavior can-login
    Behavior one.
  #end
#end
`
    });

    const result = await runCli('list', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('user');
    expect(result.stdout).toContain('api');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('can-login');
    // Should show 5 entities
    const entityCount = (result.stdout.match(/surface|fixture|instrument|behavior/gi) || []).length;
    expect(entityCount).toBeGreaterThanOrEqual(5);
  });

  it('list-by-type', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Surface one.
#end

#decl surface api
  Surface two.
#end

#decl instrument login on @{web-app}
  Instrument one.
#end

#decl instrument logout on @{web-app}
  Instrument two.
#end

#decl instrument check on @{api}
  Instrument three.
#end

#decl feature auth on @{web-app}
  #decl behavior test-one
    Behavior one.
  #end
  #decl behavior test-two
    Behavior two.
  #end
  #decl behavior test-three
    Behavior three.
  #end
  #decl behavior test-four
    Behavior four.
  #end
#end
`
    });

    const result = await runCli('list instrument', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('logout');
    expect(result.stdout).toContain('check');
    // Should NOT contain surfaces or behaviors
    expect(result.stdout).not.toContain('web-app');
    expect(result.stdout).not.toContain('test-one');
  });

  it('list-by-parent', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior test-one
    Test one.
  #end
  #decl behavior test-two
    Test two.
  #end
  #decl behavior test-three
    Test three.
  #end
#end

#decl feature other on @{my-surface}
  #decl behavior other-test
    Other test.
  #end
#end
`
    });

    const result = await runCli('list --parent auth', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('test-one');
    expect(result.stdout).toContain('test-two');
    expect(result.stdout).toContain('test-three');
    // Should NOT contain other-test
    expect(result.stdout).not.toContain('other-test');
  });

  it('list-empty-result', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Surface only.
#end

#decl instrument login on @{web-app}
  Instrument only.
#end
`
    });

    const result = await runCli('list fixture', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('no entities');
    expect(result.stdout.toLowerCase()).toContain('fixture');
  });
});
