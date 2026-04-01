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

describe('resolve-parse-errors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-catches-unclosed-decl', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl surface broken
  This declaration is never closed.
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('unclosed');
    expect(result.stderr.toLowerCase()).toContain('decl');
  });

  it('resolve-catches-invalid-nesting', async () => {
    setupProject(tmpDir, {
      'nested.bvf': `#decl surface outer
  #decl behavior inner
    Not allowed — config only permits nesting under features.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('nesting');
  });

  it('resolve-catches-for-without-in', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl surface my-surface
  Test.
#end

#decl feature broken on @{my-surface}
  #for email ["a@b.com"]
  #decl behavior test({email})
    Test.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('for');
    expect(result.stderr.toLowerCase()).toContain('in');
  });

  it('resolve-catches-for-with-invalid-array', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl surface my-surface
  Test.
#end

#decl feature broken on @{my-surface}
  #for email in not-an-array
  #decl behavior test({email})
    Test.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('array');
  });

  it('resolve-catches-for-outside-container', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#for email in ["a@b.com"]
#decl behavior test({email})
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('for');
    expect(result.stderr.toLowerCase()).toContain('outside');
  });

  it('resolve-catches-unclosed-for', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl surface my-surface
  Test.
#end

#decl feature broken on @{my-surface}
  #for email in ["a@b.com"]
  #decl behavior test({email})
    Test.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('for');
  });
});

describe('resolve-reference-errors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-catches-unresolved-reference', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl instrument broken on @{nonexistent}
  References nonexistent surface.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('nonexistent');
    expect(result.stderr.toLowerCase()).toContain('unresolved');
  });

  it('resolve-catches-missing-required-param', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Test.
#end

#decl instrument login(email, password) on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test
    Uses @{login}(email: "a@b.com").
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('password');
    expect(result.stderr.toLowerCase()).toContain('required');
  });

  it('resolve-catches-unknown-param', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Test.
#end

#decl instrument login(email, password) on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test
    Uses @{login}(username: "foo", password: "bar").
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('username');
    expect(result.stderr.toLowerCase()).toContain('unknown');
  });

  it('resolve-catches-bare-ref-needing-params', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Test.
#end

#decl instrument login(email, password) on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test
    Uses @{login}.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('login');
    expect(result.stderr.toLowerCase()).toContain('param');
  });

  it('resolve-catches-circular-dependency', async () => {
    setupProject(tmpDir, {
      'circular.bvf': `#decl surface a
  References @{b}.
#end

#decl surface b
  References @{a}.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('circular');
  });

  it('resolve-accepts-valid-references', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Test surface.
#end

#decl instrument login(email, password) on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test
    Uses @{login}(email: "a@b.com", password: "x").
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('auth');
    expect(result.stdout).toContain('login-test');
  });

  it('resolve-accepts-optional-param-omission', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl fixture user(email, role = "member")
  User fixture.
#end

#decl feature auth on @{user}
  #decl behavior test-user
    Uses @{user}(email: "a@b.com").
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('resolve-accepts-bare-ref-to-paramless-entity', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Test surface.
#end

#decl instrument check on @{web-app}
  Checks @{web-app}.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});

describe('resolve-entity-parsing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-shows-simple-entities', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Test surface.
#end

#decl fixture user
  Test fixture.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('user');
  });

  it('resolve-shows-container-with-children', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #context
    Shared setup.
  #end
  #decl behavior first-test
    First behavior.
  #end
  #decl behavior second-test
    Second behavior.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('my-feature');
    expect(result.stdout).toContain('first-test');
    expect(result.stdout).toContain('second-test');
  });

  it('resolve-shows-for-expanded-entities', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature validation on @{my-surface}
  #for email in ["a@b.com", "bad", ""]
    #decl behavior rejects-invalid({email})
      When {email} is submitted. Then validation fails.
    #end
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('rejects-invalid(a@b.com)');
    expect(result.stdout).toContain('rejects-invalid(bad)');
    expect(result.stdout).toContain('rejects-invalid()');
  });

  it('resolve-shows-for-tuple-expansion', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature validation on @{my-surface}
  #for field, value in [("email", ""), ("pw", "x")]
    #decl behavior rejects-empty-{field}
      When {value} is submitted for {field}. Then validation fails.
    #end
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('rejects-empty-email');
    expect(result.stdout).toContain('rejects-empty-pw');
  });

  it('resolve-ignores-prose-between-entities', async () => {
    setupProject(tmpDir, {
      'test.bvf': `# Prose header

This is markdown prose between declarations.

#decl surface web-app
  Test surface.
#end

More prose here.

#decl fixture user
  Test fixture.
#end

Ending prose.
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('user');
    expect(result.stdout).not.toContain('Prose header');
    expect(result.stdout).not.toContain('markdown prose');
  });

  it('resolve-ignores-decl-inside-fences', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface real-surface
  Actual declaration.
#end

Example code:
\`\`\`
#decl surface fake-example
  This is an example.
#end
\`\`\`

Another example:
\`\`\`bvf
#decl surface another-fake
  Also an example.
#end
\`\`\`
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('real-surface');
    expect(result.stdout).not.toContain('fake-example');
    expect(result.stdout).not.toContain('another-fake');
  });

  it('resolve-accepts-optional-param-syntax', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface cli-tool
  CLI surface.
#end

#decl instrument run-list(dir, type?, flags?) on @{cli-tool}
  Execute bvf list.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('run-list');
  });
});

describe('resolve-status-tracking', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-new-entity-is-pending', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior login-test
    Test.
  #end
#end
`
    });
    createManifest(tmpDir, {});

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳');
    expect(result.stdout).toContain('login-test');
  });

  it('resolve-unchanged-entity-is-current', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test behavior content.
#end
`
    });

    // Run resolve first to create manifest entry
    const firstResolve = await runCli('resolve', tmpDir);
    expect(firstResolve.exitCode).toBe(0);

    // Use CLI workflow: spec-reviewed → test-ready → test-reviewed
    await runCli('mark login-test spec-reviewed', tmpDir);
    await runCli('mark login-test test-ready --artifact test.js', tmpDir);
    const markResult = await runCli('mark login-test test-reviewed', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Do NOT edit the spec file - entity should remain current

    // Run resolve - should show entity as current (✓) with reviewed status
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout).toContain('login-test');
    
    // Verify manifest state: status=current, reason=reviewed
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['login-test'].status).toBe('current');
    expect(manifest['login-test'].reason).toBe('reviewed');
    expect(manifest['login-test'].artifact).toBe('test.js');
  });

  it('resolve-content-change-makes-stale', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Original test content.
#end
`
    });

    // Run resolve first to create manifest entry
    const firstResolve = await runCli('resolve', tmpDir);
    expect(firstResolve.exitCode).toBe(0);

    // Use CLI workflow: spec-reviewed → test-ready → test-reviewed
    await runCli('mark login-test spec-reviewed', tmpDir);
    await runCli('mark login-test test-ready --artifact test.js', tmpDir);
    const markResult = await runCli('mark login-test test-reviewed', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Edit the spec file - change content
    const specPath = join(tmpDir, 'specs', 'test.bvf');
    writeFileSync(specPath, `#decl behavior login-test
  Updated test content - spec changed!
#end
`);

    // Run resolve - should detect spec hash changed and auto-update to pending/needs-review
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳'); // pending symbol
    expect(result.stdout).toContain('login-test');
    
    // Verify manifest state: auto-updated to pending/needs-review
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('needs-review');
    expect(manifest['login-test'].artifact).toBe('test.js'); // artifact preserved
  });

  it('resolve-dependency-change-makes-stale', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Surface content.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end
`
    });

    // Run resolve first to create manifest entries
    const firstResolve = await runCli('resolve', tmpDir);
    expect(firstResolve.exitCode).toBe(0);

    // Use CLI workflow for both entities: spec-reviewed → test-ready → test-reviewed
    await runCli('mark web-app spec-reviewed', tmpDir);
    await runCli('mark web-app test-ready --artifact surface-test.js', tmpDir);
    const markSurface = await runCli('mark web-app test-reviewed', tmpDir);
    expect(markSurface.exitCode).toBe(0);
    
    await runCli('mark login spec-reviewed', tmpDir);
    await runCli('mark login test-ready --artifact login-test.js', tmpDir);
    const markInstrument = await runCli('mark login test-reviewed', tmpDir);
    expect(markInstrument.exitCode).toBe(0);

    // Edit the web-app spec file - change dependency
    const specPath = join(tmpDir, 'specs', 'test.bvf');
    writeFileSync(specPath, `#decl surface web-app
  Surface content CHANGED!
#end

#decl instrument login on @{web-app}
  Login instrument.
#end
`);

    // Run resolve - should detect both changes:
    // - web-app: spec hash mismatch (direct change)
    // - login: dependency hash mismatch (transitive change from web-app)
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳'); // pending symbol
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('login');
    
    // Verify manifest state: both auto-updated to pending/needs-review
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['web-app'].status).toBe('pending');
    expect(manifest['web-app'].reason).toBe('needs-review');
    expect(manifest['login'].status).toBe('pending');
    expect(manifest['login'].reason).toBe('needs-review');
  });

  it('resolve-transitive-dep-change-cascades', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  Surface.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end

#decl behavior can-login
  Uses @{login}.
#end
`
    });

    // Run resolve first to create manifest entries
    const firstResolve = await runCli('resolve', tmpDir);
    expect(firstResolve.exitCode).toBe(0);

    // Use CLI workflow for all three entities: spec-reviewed → test-ready → test-reviewed
    await runCli('mark web-app spec-reviewed', tmpDir);
    await runCli('mark web-app test-ready --artifact surface-test.js', tmpDir);
    const markSurface = await runCli('mark web-app test-reviewed', tmpDir);
    expect(markSurface.exitCode).toBe(0);
    
    await runCli('mark login spec-reviewed', tmpDir);
    await runCli('mark login test-ready --artifact login-test.js', tmpDir);
    const markInstrument = await runCli('mark login test-reviewed', tmpDir);
    expect(markInstrument.exitCode).toBe(0);
    
    await runCli('mark can-login spec-reviewed', tmpDir);
    await runCli('mark can-login test-ready --artifact can-login-test.js', tmpDir);
    const markBehavior = await runCli('mark can-login test-reviewed', tmpDir);
    expect(markBehavior.exitCode).toBe(0);

    // Edit the web-app spec file - change root dependency
    const specPath = join(tmpDir, 'specs', 'test.bvf');
    writeFileSync(specPath, `#decl surface web-app
  Surface CHANGED!
#end

#decl instrument login on @{web-app}
  Login instrument.
#end

#decl behavior can-login
  Uses @{login}.
#end
`);

    // Run resolve - should detect transitive cascade:
    // - web-app: spec hash changed (direct edit)
    // - login: dependency hash changed (web-app changed)
    // - can-login: dependency hash changed (login changed transitively)
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳'); // pending symbol
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('can-login');
    
    // Verify manifest state: all three auto-updated to pending/needs-review
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['web-app'].status).toBe('pending');
    expect(manifest['web-app'].reason).toBe('needs-review');
    expect(manifest['login'].status).toBe('pending');
    expect(manifest['login'].reason).toBe('needs-review');
    expect(manifest['can-login'].status).toBe('pending');
    expect(manifest['can-login'].reason).toBe('needs-review');
  });

  it('resolve-change-during-pending-review', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Original content.
#end
`
    });

    // Manually create manifest with entity in pending/needs-review (new, not yet reviewed)
    // This simulates an entity that exists but hasn't gone through spec review yet
    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-review',
        specHash: 'initial-hash',
        dependencyHash: '',
        materializedAt: Date.now()
      }
    });

    // Edit the spec file while in pending/needs-review state
    const specPath = join(tmpDir, 'specs', 'test.bvf');
    writeFileSync(specPath, `#decl behavior login-test
  Content changed during pending review.
#end
`);

    // Run resolve - should update hashes but remain pending/needs-review
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳'); // pending symbol
    expect(result.stdout).toContain('login-test');
    
    // Verify manifest state: still pending/needs-review, but hashes updated
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('needs-review');
  });

  it('resolve-change-after-spec-reviewed', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Original content.
#end
`
    });

    // Manually create manifest with entity in pending/reviewed (spec approved, ready for materialization)
    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'reviewed',
        specHash: 'initial-hash',
        dependencyHash: '',
        materializedAt: Date.now()
      }
    });

    // Edit the spec file after spec review
    const specPath = join(tmpDir, 'specs', 'test.bvf');
    writeFileSync(specPath, `#decl behavior login-test
  Content changed after spec review!
#end
`);

    // Run resolve - should detect spec hash changed and auto-restart to pending/needs-review
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳'); // pending symbol
    expect(result.stdout).toContain('login-test');
    
    // Verify manifest state: auto-updated back to pending/needs-review
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('needs-review');
  });

  it('resolve-change-during-test-review', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Original content.
#end
`
    });

    // Manually create manifest with entity in current/needs-review (test materialized, awaiting alignment review)
    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'current',
        reason: 'needs-review',
        specHash: 'initial-hash',
        dependencyHash: '',
        artifact: 'tests/login.test.ts',
        materializedAt: Date.now()
      }
    });

    // Edit the spec file while test is awaiting review
    const specPath = join(tmpDir, 'specs', 'test.bvf');
    writeFileSync(specPath, `#decl behavior login-test
  Content changed during test review!
#end
`);

    // Run resolve - should detect spec hash changed and auto-restart to pending/needs-review
    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳'); // pending symbol
    expect(result.stdout).toContain('login-test');
    
    // Verify manifest state: auto-updated to pending/needs-review, artifact preserved
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('needs-review');
    expect(manifest['login-test'].artifact).toBe('tests/login.test.ts'); // preserved
  });

  it('resolve-orphaned-entity-detected', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end
`
    });

    createManifest(tmpDir, {
      'old-test': {
        type: 'behavior',
        status: 'current',
        specHash: 'old-hash',
        dependencyHash: 'old-dep',
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('orphan');
    expect(result.stdout).toContain('old-test');
  });

});

describe('resolve-output-format', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-clean-project', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior test-one
    Test.
  #end
  #decl behavior test-two
    Test.
  #end
#end
`;
    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    // Run resolve once to get the correct hashes
    await runCli('resolve', tmpDir);
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const tempManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    
    // Now create a manifest with all entities marked as current/reviewed with the correct hashes
    createManifest(tmpDir, {
      'my-surface': {
        ...tempManifest['my-surface'],
        status: 'current',
        reason: 'reviewed',
        materializedAt: Date.now()
      },
      'test-one': {
        ...tempManifest['test-one'],
        status: 'current',
        reason: 'reviewed',
        materializedAt: Date.now()
      },
      'test-two': {
        ...tempManifest['test-two'],
        status: 'current',
        reason: 'reviewed',
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout.toLowerCase()).toContain('errors: 0');
    expect(result.stdout.toLowerCase()).toContain('stale: 0');
    expect(result.stdout.toLowerCase()).toContain('pending: 0');
  });

  it('resolve-mixed-statuses-ordered', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature feature-a on @{my-surface}
  #decl behavior test-current
    Current.
  #end
#end

#decl feature feature-b on @{my-surface}
  #decl behavior test-stale
    Stale.
  #end
  #decl behavior test-pending
    Pending.
  #end
#end
`
    });

    // Run resolve once to get correct hashes
    await runCli('resolve', tmpDir);
    const manifestPath = join(tmpDir, '.bvf-state', 'manifest.json');
    const tempManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    // Create manifest with mixed states:
    // - test-current: current + reviewed with correct hash (will stay ✓)
    // - test-stale: use wrong hash to make it stale (auto-transitions to pending/needs-review → ⏳)
    // - test-pending: omit from manifest (will be detected as new → ⏳)
    const crypto = require('crypto');
    const staleHash = crypto.createHash('sha256').update('old-stale-content-that-doesnt-match').digest('hex');
    
    createManifest(tmpDir, {
      'test-current': {
        ...tempManifest['test-current'],
        status: 'current',
        reason: 'reviewed',
        materializedAt: Date.now()
      },
      'test-stale': {
        ...tempManifest['test-stale'],
        status: 'current',
        reason: 'reviewed',
        specHash: staleHash,  // Wrong hash triggers auto-transition to pending/needs-review
        materializedAt: Date.now()
      }
      // test-pending not in manifest - will show as pending
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');   // test-current
    expect(result.stdout).toContain('⏳');  // test-stale (auto-transitioned) and test-pending
    
    // With auto-transitions, stale entities become pending/needs-review, not stale
    // So we expect Summary to show: Current: 1, Pending: 3 (including my-surface), Stale: 0
    expect(result.stdout.toLowerCase()).toMatch(/current:\s*1/);
    expect(result.stdout.toLowerCase()).toMatch(/pending:\s*3/);
    expect(result.stdout.toLowerCase()).toMatch(/stale:\s*0/);
    
    const lines = result.stdout.split('\n');
    const currentIdx = lines.findIndex(l => l.includes('test-current'));
    const staleIdx = lines.findIndex(l => l.includes('test-stale'));
    const pendingIdx = lines.findIndex(l => l.includes('test-pending'));
    expect(currentIdx).toBeGreaterThan(-1);
    expect(staleIdx).toBeGreaterThan(-1);
    expect(pendingIdx).toBeGreaterThan(-1);
  });

  it('resolve-with-diff', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl instrument run-resolve on @{my-surface}
  Instrument.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior some-test
    Stale test.
  #end
  #decl behavior new-thing
    New pending.
  #end
#end
`
    });

    const crypto = require('crypto');
    const oldHash = crypto.createHash('sha256').update('old').digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('dep').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'run-resolve': {
        type: 'instrument',
        status: 'stale',
        reason: 'content-changed',
        specHash: oldHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      },
      'some-test': {
        type: 'behavior',
        status: 'stale',
        reason: 'content-changed',
        specHash: oldHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve --diff', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/stale\s+instrument\s+run-resolve\s+specs\/test\.bvf:\d+/);
    expect(result.stdout).toMatch(/stale\s+behavior\s+some-test\s+specs\/test\.bvf:\d+/);
    expect(result.stdout).toMatch(/pending\s+behavior\s+new-thing\s+specs\/test\.bvf:\d+/);
  });
});

describe('resolve-exit-codes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-exits-zero-on-success', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior test-stale
    Stale.
  #end
  #decl behavior test-pending
    Pending.
  #end
#end
`
    });

    const crypto = require('crypto');
    const oldHash = crypto.createHash('sha256').update('old').digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('dep').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'test-stale': {
        type: 'behavior',
        status: 'stale',
        reason: 'content-changed',
        specHash: oldHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
  });

  it('resolve-exits-one-on-error', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl instrument broken on @{nonexistent}
  Unresolved reference.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
  });
});

describe('resolve-materializable', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-counts-only-materializable', async () => {
    const config = `#config
  types: service, endpoint, scenario, fixture
  containment:
    service: endpoint
    endpoint: scenario
  materializable: scenario
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl service payments
  Payment service.
  #decl endpoint create-charge
    Create charge endpoint.
    #decl scenario charge-succeeds
      Charge is created.
    #end
  #end
#end

#decl fixture test-db
  Test database fixture.
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    // Summary should count only scenarios (1)
    // Fixture is NOT counted even though standalone (not in materializable list)
    expect(result.stdout.toLowerCase()).toMatch(/pending:\s*1/);
  });

  it('resolve-shows-non-materializable-in-tree', async () => {
    const config = `#config
  types: service, endpoint, scenario, fixture
  containment:
    service: endpoint
    endpoint: scenario
  materializable: scenario
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl service payments
  Payment service.
  #decl endpoint create-charge
    Create charge endpoint.
    #decl scenario charge-succeeds
      Charge is created.
    #end
  #end
#end

#decl fixture test-db
  Test database fixture.
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    // All entities appear in tree, but only scenario has status symbol
    expect(result.stdout).toContain('payments');
    expect(result.stdout).toContain('service');
    expect(result.stdout).toContain('create-charge');
    expect(result.stdout).toContain('endpoint');
    expect(result.stdout).toContain('charge-succeeds');
    expect(result.stdout).toContain('⏳'); // scenario has status
    expect(result.stdout).toContain('test-db');
    expect(result.stdout).toContain('fixture');
  });

  it('resolve-diff-excludes-non-materializable', async () => {
    const config = `#config
  types: service, endpoint, scenario, fixture
  containment:
    service: endpoint
    endpoint: scenario
  materializable: scenario
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl service payments
  Payment service.
  #decl endpoint create-charge
    Create charge endpoint.
    #decl scenario charge-succeeds
      Charge is created.
    #end
  #end
#end

#decl fixture test-db
  Test database fixture.
#end`
    }, config);

    const result = await runCli('resolve --diff', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    // Only materializable entities in diff output
    expect(result.stdout).toMatch(/pending\s+scenario\s+charge-succeeds/);
    // Service, endpoint, and fixture should NOT appear
    expect(result.stdout).not.toContain('payments');
    expect(result.stdout).not.toContain('create-charge');
    expect(result.stdout).not.toContain('test-db');
  });

  it('resolve-displays-group-as-header', async () => {
    const config = `#config
  types: feature, behavior, group, surface
  containment:
    feature: behavior, group
    group: behavior
  materializable: behavior
#end`;
    setupProject(tmpDir, {
      'test.bvf': `#decl feature payments on @{some-surface}
  #decl behavior charge-succeeds
    Happy path.
  #end

  #decl group error-handling
    #decl behavior charge-fails
      Invalid card.
    #end
  #end
#end

#decl surface some-surface
  Test surface.
#end`
    }, config);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    // Group appears as header without status symbol
    expect(result.stdout).toContain('error-handling');
    expect(result.stdout).toContain('group');
    // Behaviors have status symbols
    expect(result.stdout).toContain('charge-succeeds');
    expect(result.stdout).toContain('charge-fails');
    expect(result.stdout).toContain('⏳');
    // Verify hierarchical display: charge-fails appears after error-handling
    const groupIdx = result.stdout.indexOf('error-handling');
    const failIdx = result.stdout.indexOf('charge-fails');
    expect(groupIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeGreaterThan(groupIdx);
  });
});
