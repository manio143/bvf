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
  if (config !== undefined) {
    writeFileSync(join(dir, 'bvf.config'), config);
  }
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, 'specs', name);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content);
  }
}

describe('config-taxonomy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config-defines-types', async () => {
    const config = `#config
  types: surface, fixture, instrument, behavior, feature
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('config-defines-containment', async () => {
    const config = `#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior my-behavior
    Test behavior.
  #end
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('config-rejects-invalid-nesting', async () => {
    const config = `#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end

#decl instrument my-instrument on @{my-surface}
  #decl behavior my-behavior
    Invalid nesting.
  #end
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('behavior');
    expect(result.stderr.toLowerCase()).toContain('instrument');
  });

  it('config-allows-multiple-containment-rules', async () => {
    const config = `#config
  types: epic, story, task, surface
  containment:
    epic: story
    story: task
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end

#decl epic my-epic on @{my-surface}
  #decl story my-story
    #decl task my-task
      Test task.
    #end
  #end
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('config-no-containment-means-no-nesting', async () => {
    const config = `#config
  types: surface, behavior
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  #decl behavior my-behavior
    Invalid nesting without containment rules.
  #end
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('nesting');
  });

  it('config-containment-is-not-transitive', async () => {
    const config = `#config
  types: epic, story, task
  containment:
    epic: story
    story: task
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl epic my-epic
  #decl task my-task
    Direct epic->task nesting not allowed.
  #end
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('task');
    expect(result.stderr.toLowerCase()).toContain('epic');
  });

  it('config-containment-allows-multiple-children', async () => {
    const config = `#config
  types: feature, behavior, constraint
  containment:
    feature: behavior, constraint
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl feature my-feature
  #decl behavior my-behavior
    Behavior content.
  #end
  #decl constraint my-constraint
    Constraint content.
  #end
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

describe('config-settings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config-custom-file-extension', async () => {
    const config = `#config
  types: surface
  file-extension: .spec
#end`;
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    mkdirSync(join(tmpDir, '.bvf-state'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), config);
    writeFileSync(join(tmpDir, 'specs', 'test.spec'), `#decl surface my-surface
  Test surface.
#end`);
    writeFileSync(join(tmpDir, 'specs', 'ignored.bvf'), `#decl surface ignored
  Should be ignored.
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('my-surface');
    expect(result.stdout).not.toContain('ignored');
  });

  it('config-custom-state-dir', async () => {
    const config = `#config
  types: surface
  state-dir: .my-state
#end`;
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    mkdirSync(join(tmpDir, '.my-state'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), config);
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), `#decl surface my-surface
  Test surface.
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    // Verify manifest was created in custom dir
    const manifestPath = join(tmpDir, '.my-state', 'manifest.json');
    const fs = require('fs');
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('config-defaults', async () => {
    mkdirSync(tmpDir, { recursive: true });

    const result = await runCli('init', tmpDir);

    expect(result.exitCode).toBe(0);
    const configPath = join(tmpDir, 'bvf.config');
    const fs = require('fs');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    expect(configContent).toContain('types: surface, fixture, instrument, behavior, feature');
    expect(configContent).toContain('containment:');
    expect(configContent).toContain('feature: behavior');
    expect(configContent).toContain('file-extension: .bvf');
    expect(configContent).toContain('state-dir: .bvf-state');
  });

  it('config-ignores-unknown-keys', async () => {
    const config = `#config
  types: surface
  unknown-key: some-value
  another-unknown: 123
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('config-trims-whitespace-from-types', async () => {
    const config = `#config
  types:  surface ,  fixture  , instrument
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test surface.
#end

#decl fixture my-fixture
  Test fixture.
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

describe('config-errors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config-rejects-missing-types', async () => {
    const config = `#config
  file-extension: .bvf
#end`;
    setupProject(tmpDir, {}, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('types');
    expect(result.stderr.toLowerCase()).toContain('required');
  });

  it('config-rejects-empty-types', async () => {
    const config = `#config
  types:
#end`;
    setupProject(tmpDir, {}, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('types');
    expect(result.stderr.toLowerCase()).toContain('empty');
  });

  it('config-rejects-no-colon', async () => {
    const config = `#config
  types surface, fixture
#end`;
    setupProject(tmpDir, {}, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('syntax');
  });

  it('config-rejects-empty-value', async () => {
    const config = `#config
  file-extension:
#end`;
    setupProject(tmpDir, {}, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('value');
  });

  it('config-rejects-bare-text', async () => {
    const config = `types: surface, fixture`;
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    mkdirSync(join(tmpDir, '.bvf-state'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('#config');
  });

  it('config-rejects-unclosed-config', async () => {
    const config = `#config
  types: surface, fixture`;
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    mkdirSync(join(tmpDir, '.bvf-state'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('unclosed');
  });

  it('config-rejects-duplicate-config', async () => {
    const config = `#config
  types: surface
#end

#config
  types: fixture
#end`;
    setupProject(tmpDir, {}, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('multiple');
  });

  it('config-rejects-unknown-type-in-containment', async () => {
    const config = `#config
  types: surface, behavior
  containment:
    feature: behavior
#end`;
    setupProject(tmpDir, {}, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('feature');
    expect(result.stderr.toLowerCase()).toContain('unknown');
  });
});
