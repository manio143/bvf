import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'fs';
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

describe('cli-resolve', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'bvf-cli-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('resolve-clean-project', async () => {
    // Setup: Create a valid project
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, fixture, instrument, behavior, feature
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
  Login to the app.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    // Run resolve once to parse entities and compute real hashes,
    // then build a manifest with those actual hashes so entities are "current"
    const { parseBvfFile } = await import('../src/parser');
    const { computeSpecHash, computeDependencyHash } = await import('../src/manifest');
    const { resolveReferences } = await import('../src/resolver');
    const { parseConfig } = await import('../src/config');

    const specContent = readFileSync(join(specsDir, 'test.bvf'), 'utf-8');
    const config = parseConfig(readFileSync(join(projectDir, 'bvf.config'), 'utf-8'));
    const parsed = parseBvfFile(specContent);
    const resolved = resolveReferences(parsed.value!, config.value!);

    const entityHashes = new Map<string, string>();
    for (const entity of resolved.value!) {
      entityHashes.set(entity.name, computeSpecHash(entity));
    }

    const manifest: Record<string, any> = {};
    for (const entity of resolved.value!) {
      const specHash = computeSpecHash(entity);
      const dependencyHash = computeDependencyHash(entity, entityHashes);
      manifest[entity.name] = {
        name: entity.name,
        specHash,
        dependencyHash,
        artifact: `tests/${entity.name}.spec.ts`,
        materializedAt: new Date().toISOString()
      };
    }

    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Run resolve
    const result = await runCli('resolve', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/✓.*web-app/);
    expect(result.stdout).toMatch(/✓.*login/);
    expect(result.stdout).toMatch(/Errors: 0/);
    expect(result.stdout).toMatch(/Stale: 0/);
  });

  it('resolve-with-stale-entities', async () => {
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
  A web application - CHANGED CONTENT.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    // Manifest has old hash
    const manifest = {
      'web-app': {
        name: 'web-app',
        specHash: 'old-hash',
        dependencyHash: 'old-hash',
        artifact: 'tests/web-app.spec.ts',
        materializedAt: new Date().toISOString()
      }
    };

    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const result = await runCli('resolve', projectDir);

    expect(result.exitCode).toBe(0); // Stale is not an error
    expect(result.stdout).toMatch(/✗.*web-app/);
    expect(result.stdout).toMatch(/content.*changed/i);
    expect(result.stdout).toMatch(/Stale: 1/);
  });

  it('resolve-with-errors', async () => {
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: behavior, fixture
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'broken.bvf'), `
#decl behavior test-behavior
  Uses @{nonexistent}.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    const result = await runCli('resolve', projectDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/nonexistent.*unresolved/i);
    expect(result.stdout).toMatch(/Errors: 1/);
  });

  it('resolve-with-diff', async () => {
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
  Added a new line here.
#end
    `);

    const stateDir = join(projectDir, '.bvf-state');
    mkdirSync(stateDir);

    const manifest = {
      'login-test': {
        name: 'login-test',
        specHash: 'old-hash',
        dependencyHash: 'old-hash',
        artifact: 'tests/login-test.spec.ts',
        materializedAt: new Date().toISOString()
      }
    };

    writeFileSync(join(stateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const result = await runCli('resolve --diff', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\+.*Added a new line/);
  });
});

describe('cli-list', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'bvf-cli-list-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('list-all-entities', async () => {
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, fixture, instrument
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'file1.bvf'), `
#decl surface app1
  App 1.
#end

#decl surface app2
  App 2.
#end
    `);

    writeFileSync(join(specsDir, 'file2.bvf'), `
#decl fixture data1
  Data 1.
#end

#decl instrument tool1
  Tool 1.
#end

#decl instrument tool2
  Tool 2.
#end
    `);

    const result = await runCli('list', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/app1/);
    expect(result.stdout).toMatch(/app2/);
    expect(result.stdout).toMatch(/data1/);
    expect(result.stdout).toMatch(/tool1/);
    expect(result.stdout).toMatch(/tool2/);
    expect(result.stdout).toMatch(/file1\.bvf/);
    expect(result.stdout).toMatch(/file2\.bvf/);
  });

  it('list-by-type', async () => {
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, fixture, instrument
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl surface app1
  App 1.
#end

#decl instrument tool1
  Tool 1.
#end

#decl instrument tool2
  Tool 2.
#end

#decl fixture data1
  Data 1.
#end
    `);

    const result = await runCli('list instrument', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/tool1/);
    expect(result.stdout).toMatch(/tool2/);
    expect(result.stdout).not.toMatch(/app1/);
    expect(result.stdout).not.toMatch(/data1/);
  });

  it('list-by-feature', async () => {
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: feature, behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl feature auth
  #behavior login
    Login test.
  #end

  #behavior logout
    Logout test.
  #end

  #behavior signup
    Signup test.
  #end
#end

#decl feature other-feature
  #behavior other-test
    Other test.
  #end
#end
    `);

    const result = await runCli('list --feature auth', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/login/);
    expect(result.stdout).toMatch(/logout/);
    expect(result.stdout).toMatch(/signup/);
    expect(result.stdout).not.toMatch(/other-test/);
  });

  it('list-empty-result', async () => {
    writeFileSync(join(projectDir, 'bvf.config'), `
#config
  types: surface, fixture
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const specsDir = join(projectDir, 'specs');
    mkdirSync(specsDir);

    writeFileSync(join(specsDir, 'test.bvf'), `
#decl surface app1
  App 1.
#end
    `);

    const result = await runCli('list fixture', projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No entities of type 'fixture' found/i);
  });
});

describe('cli-init', () => {
  let emptyDir: string;

  beforeEach(() => {
    emptyDir = mkdtempSync(join(tmpdir(), 'bvf-init-test-'));
  });

  afterEach(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('init-creates-config', async () => {
    const result = await runCli('init', emptyDir);

    expect(result.exitCode).toBe(0);

    // Check files were created
    const configPath = join(emptyDir, 'bvf.config');
    const specsPath = join(emptyDir, 'specs');
    const statePath = join(emptyDir, '.bvf-state');

    expect(readFileSync(configPath, 'utf-8')).toContain('#config');
    expect(readFileSync(configPath, 'utf-8')).toContain('types:');
    expect(readFileSync(configPath, 'utf-8')).toContain('surface');
    expect(readFileSync(configPath, 'utf-8')).toContain('fixture');
    expect(readFileSync(configPath, 'utf-8')).toContain('instrument');
    expect(readFileSync(configPath, 'utf-8')).toContain('behavior');
    expect(readFileSync(configPath, 'utf-8')).toContain('feature');

    // Check directories were created
    expect(statSync(specsPath).isDirectory()).toBe(true);
    expect(statSync(statePath).isDirectory()).toBe(true);
  });

  it('init-refuses-existing-project', async () => {
    // Create a config first
    writeFileSync(join(emptyDir, 'bvf.config'), `
#config
  types: surface
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `);

    const result = await runCli('init', emptyDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/already initialized/i);
  });
});
