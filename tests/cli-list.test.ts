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
      'file1.bvf': `#decl surface app
#end

#decl fixture data
#end
`,
      'file2.bvf': `#decl instrument tool on @{app}
#end

#decl behavior test-1
#end

#decl behavior test-2
#end
`
    });

    const result = await runCli('list', tmpDir);

    expect(result.exitCode).toBe(0);
    
    // Spec: "all 5 entities are listed with their type, name, and source file location"
    // Output format groups by type, then shows name and file path on each line
    // Example:
    //   surface:
    //     app  file1.bvf
    //   fixture:
    //     data  file1.bvf
    
    const entities = [
      { name: 'app', type: 'surface', file: 'file1.bvf' },
      { name: 'data', type: 'fixture', file: 'file1.bvf' },
      { name: 'tool', type: 'instrument', file: 'file2.bvf' },
      { name: 'test-1', type: 'behavior', file: 'file2.bvf' },
      { name: 'test-2', type: 'behavior', file: 'file2.bvf' }
    ];
    
    // Verify each entity name appears in output
    for (const entity of entities) {
      expect(result.stdout, `Entity "${entity.name}" should appear in output`).toContain(entity.name);
      expect(result.stdout, `Entity "${entity.name}" source file "${entity.file}" should appear`).toContain(entity.file);
    }
    
    // Verify type headers appear
    expect(result.stdout).toContain('surface:');
    expect(result.stdout).toContain('fixture:');
    expect(result.stdout).toContain('instrument:');
    expect(result.stdout).toContain('behavior:');
    
    // Verify correct total count
    expect(result.stdout).toContain('Total: 5');
  });

  it('list-by-type', async () => {
    setupProject(tmpDir, {
      'entities.bvf': `#decl surface app-1
#end

#decl surface app-2
#end

#decl instrument tool-1 on @{app-1}
#end

#decl instrument tool-2 on @{app-1}
#end

#decl instrument tool-3 on @{app-2}
#end

#decl behavior test-1
#end

#decl behavior test-2
#end

#decl behavior test-3
#end

#decl behavior test-4
#end
`
    });

    const result = await runCli('list instrument', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('tool-1');
    expect(result.stdout).toContain('tool-2');
    expect(result.stdout).toContain('tool-3');
    expect(result.stdout).toContain('Total: 3');
    
    // Should not contain other types
    expect(result.stdout).not.toContain('app-1');
    expect(result.stdout).not.toContain('test-1');
  });

  it('list-by-feature', async () => {
    setupProject(tmpDir, {
      'feature.bvf': `#decl surface app
#end

#decl feature auth on @{app}
  #behavior can-login
    Test login.
  #end
  #behavior can-logout
    Test logout.
  #end
  #behavior can-reset-password
    Test password reset.
  #end
#end

#decl behavior standalone-test
  Standalone.
#end
`
    });

    const result = await runCli('list --feature auth', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('can-login');
    expect(result.stdout).toContain('can-logout');
    expect(result.stdout).toContain('can-reset-password');
    expect(result.stdout).toContain('Total: 3');
    
    // Should not contain standalone behavior
    expect(result.stdout).not.toContain('standalone-test');
  });

  it('list-empty-result', async () => {
    setupProject(tmpDir, {
      'no-fixtures.bvf': `#decl surface app
#end

#decl behavior test
#end
`
    });

    const result = await runCli('list fixture', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No entities of type 'fixture' found");
  });
});
