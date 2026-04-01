import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'fs';
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

function readManifest(dir: string): Record<string, any> {
  const manifestPath = join(dir, '.bvf-state', 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

describe('cli-remove-orphans', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('remove-orphans-deletes-entry', async () => {
    // Setup: Initialize project with a spec file
    setupProject(projectDir, {
      'test.bvf': `
#decl behavior old-test
  Given something.
  When action.
  Then result.
#end
`
    });

    // Initialize BVF to create manifest
    await runCli('init', projectDir);

    // Resolve to populate manifest with the entity
    await runCli('resolve', projectDir);

    // Mark as test-ready with artifact path
    const testPath = 'tests/old.test.ts';
    await runCli(`mark old-test test-ready --artifact "${testPath}"`, projectDir);

    // Create the test artifact file
    const fullTestPath = join(projectDir, testPath);
    mkdirSync(join(fullTestPath, '..'), { recursive: true });
    writeFileSync(fullTestPath, '// test content');

    // Delete the spec file to orphan the entity
    unlinkSync(join(projectDir, 'specs', 'test.bvf'));

    // Resolve again - entity should become orphaned
    await runCli('resolve', projectDir);

    // Verify entity is orphaned
    let manifest = readManifest(projectDir);
    expect(manifest['old-test']).toBeDefined();
    expect(manifest['old-test'].status).toBe('orphaned');

    // Delete the artifact file (precondition for safe removal)
    unlinkSync(fullTestPath);

    // When: Run remove-orphans command
    const result = await runCli('remove-orphans old-test', projectDir);

    // Then: Manifest entry is removed
    manifest = readManifest(projectDir);
    expect(manifest['old-test']).toBeUndefined();

    // And: Stdout confirms removal
    expect(result.stdout).toContain('Removed orphaned entry: old-test');

    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('remove-orphans-warns-if-artifact-exists', async () => {
    // Setup: Initialize project with a spec
    setupProject(projectDir, {
      'test.bvf': `
#decl behavior old-test
  Given something.
  When action.
  Then result.
#end
`
    });

    await runCli('init', projectDir);
    await runCli('resolve', projectDir);

    // Mark as spec-reviewed first (required before test-ready)
    await runCli('mark old-test spec-reviewed', projectDir);
    
    // Mark with artifact
    const testPath = 'tests/old.test.ts';
    await runCli(`mark old-test test-ready --artifact "${testPath}"`, projectDir);

    // Create the artifact file
    const fullTestPath = join(projectDir, testPath);
    mkdirSync(join(fullTestPath, '..'), { recursive: true });
    writeFileSync(fullTestPath, '// test content');

    // Delete spec to orphan
    unlinkSync(join(projectDir, 'specs', 'test.bvf'));
    await runCli('resolve', projectDir);

    // When: Try to remove orphan while artifact still exists
    const result = await runCli('remove-orphans old-test', projectDir);

    // Then: Stderr warns about existing artifact
    expect(result.stderr).toMatch(/Artifact still exists.*tests\/old\.test\.ts.*delete it first/);

    // And: Manifest entry is NOT removed
    const manifest = readManifest(projectDir);
    expect(manifest['old-test']).toBeDefined();
    expect(manifest['old-test'].status).toBe('orphaned');

    // Exit code is 1
    expect(result.exitCode).toBe(1);
  });

  it('remove-orphans-force-flag', async () => {
    // Setup: Initialize project and create orphaned entity with artifact
    setupProject(projectDir, {
      'test.bvf': `
#decl behavior old-test
  Given something.
  When action.
  Then result.
#end
`
    });

    await runCli('init', projectDir);
    await runCli('resolve', projectDir);

    // Mark as spec-reviewed first (required before test-ready)
    await runCli('mark old-test spec-reviewed', projectDir);
    
    const testPath = 'tests/old.test.ts';
    await runCli(`mark old-test test-ready --artifact "${testPath}"`, projectDir);

    // Create artifact
    const fullTestPath = join(projectDir, testPath);
    mkdirSync(join(fullTestPath, '..'), { recursive: true });
    writeFileSync(fullTestPath, '// test content');

    // Orphan the entity
    unlinkSync(join(projectDir, 'specs', 'test.bvf'));
    await runCli('resolve', projectDir);

    // When: Remove with --force flag (artifact still exists)
    const result = await runCli('remove-orphans old-test --force', projectDir);

    // Then: Manifest entry is removed despite artifact existing
    const manifest = readManifest(projectDir);
    expect(manifest['old-test']).toBeUndefined();

    // And: Stdout warns about removal with existing artifact
    expect(result.stdout).toMatch(/Removed orphaned entry \(artifact still exists\): old-test/);

    // Exit code is 0
    expect(result.exitCode).toBe(0);

    // Artifact file still exists
    expect(existsSync(fullTestPath)).toBe(true);
  });

  it('remove-orphans-multiple-entries', async () => {
    // Setup: Create project with 3 entities
    setupProject(projectDir, {
      'tests.bvf': `
#decl behavior test-1
  Given something.
  When action.
  Then result.
#end

#decl behavior test-2
  Given something.
  When action.
  Then result.
#end

#decl behavior test-3
  Given something.
  When action.
  Then result.
#end
`
    });

    await runCli('init', projectDir);
    await runCli('resolve', projectDir);

    // Mark all three with artifacts
    const testPaths = ['tests/test-1.test.ts', 'tests/test-2.test.ts', 'tests/test-3.test.ts'];
    for (let i = 0; i < 3; i++) {
      await runCli(`mark test-${i + 1} test-ready --artifact "${testPaths[i]}"`, projectDir);
      const fullPath = join(projectDir, testPaths[i]);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, `// test ${i + 1}`);
    }

    // Orphan all by deleting spec
    unlinkSync(join(projectDir, 'specs', 'tests.bvf'));
    await runCli('resolve', projectDir);

    // Delete all artifact files
    testPaths.forEach(path => unlinkSync(join(projectDir, path)));

    // When: Remove all three orphans in one command
    const result = await runCli('remove-orphans test-1 test-2 test-3', projectDir);

    // Then: All three entries are removed
    const manifest = readManifest(projectDir);
    expect(manifest['test-1']).toBeUndefined();
    expect(manifest['test-2']).toBeUndefined();
    expect(manifest['test-3']).toBeUndefined();

    // And: Stdout lists all removed entries
    expect(result.stdout).toContain('test-1');
    expect(result.stdout).toContain('test-2');
    expect(result.stdout).toContain('test-3');

    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('remove-orphans-nonexistent-entry', async () => {
    // Setup: Initialize empty project
    setupProject(projectDir, {});
    await runCli('init', projectDir);

    // When: Try to remove nonexistent entity
    const result = await runCli('remove-orphans nonexistent', projectDir);

    // Then: Stderr reports error
    expect(result.stderr).toMatch(/Error.*Entity 'nonexistent' not found in manifest/);

    // Exit code is 1
    expect(result.exitCode).toBe(1);
  });

  it('remove-orphans-non-orphaned-entry', async () => {
    // Setup: Create project with active entity
    setupProject(projectDir, {
      'test.bvf': `
#decl behavior active-test
  Given something.
  When action.
  Then result.
#end
`
    });

    await runCli('init', projectDir);
    await runCli('resolve', projectDir);

    // Mark as spec-reviewed first, then test-ready (status: current, reason: needs-review)
    await runCli('mark active-test spec-reviewed', projectDir);
    await runCli('mark active-test test-ready --artifact "tests/active.test.ts"', projectDir);
    // Mark as test-reviewed to get status: current, reason: reviewed
    await runCli('mark active-test test-reviewed', projectDir);

    // When: Try to remove non-orphaned entity
    const result = await runCli('remove-orphans active-test', projectDir);

    // Then: Stderr reports error about status
    expect(result.stderr).toMatch(/Error.*Entity 'active-test' is not orphaned \(status: current\)/);

    // And: Manifest entry is NOT removed
    const manifest = readManifest(projectDir);
    expect(manifest['active-test']).toBeDefined();
    expect(manifest['active-test'].status).toBe('current');

    // Exit code is 1
    expect(result.exitCode).toBe(1);
  });

  it('remove-orphans-all-flag', async () => {
    // Setup: Create project with 3 entities
    setupProject(projectDir, {
      'tests.bvf': `
#decl behavior orphan-1
  Given something.
  When action.
  Then result.
#end

#decl behavior orphan-2
  Given something.
  When action.
  Then result.
#end

#decl behavior orphan-3
  Given something.
  When action.
  Then result.
#end
`
    });

    await runCli('init', projectDir);
    await runCli('resolve', projectDir);

    // Mark all with artifacts
    const entities = ['orphan-1', 'orphan-2', 'orphan-3'];
    for (const entity of entities) {
      const path = `tests/${entity}.test.ts`;
      await runCli(`mark ${entity} test-ready --artifact "${path}"`, projectDir);
      const fullPath = join(projectDir, path);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, `// ${entity}`);
    }

    // Orphan all
    unlinkSync(join(projectDir, 'specs', 'tests.bvf'));
    await runCli('resolve', projectDir);

    // Delete all artifacts
    entities.forEach(entity => {
      unlinkSync(join(projectDir, `tests/${entity}.test.ts`));
    });

    // When: Remove all orphans with --all flag
    const result = await runCli('remove-orphans --all', projectDir);

    // Then: All orphaned entries are removed
    const manifest = readManifest(projectDir);
    expect(manifest['orphan-1']).toBeUndefined();
    expect(manifest['orphan-2']).toBeUndefined();
    expect(manifest['orphan-3']).toBeUndefined();

    // And: Stdout lists count
    expect(result.stdout).toMatch(/Removed 3 orphaned entries/);

    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });
});
