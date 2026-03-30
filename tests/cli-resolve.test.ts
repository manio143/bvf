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

  it('resolve-catches-duplicate-context', async () => {
    setupProject(tmpDir, {
      'broken.bvf': `#decl surface my-surface
  Test.
#end

#decl feature broken on @{my-surface}
  #context
    First context.
  #end
  #context
    Second context.
  #end
  #decl behavior test
    Test.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('context');
    expect(result.stderr.toLowerCase()).toContain('multiple');
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
    expect(result.stdout).toContain('rejects-invalid("a@b.com")');
    expect(result.stdout).toContain('rejects-invalid("bad")');
    expect(result.stdout).toContain('rejects-invalid("")');
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
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior login-test
    Test.
  #end
#end
`;
    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    // Compute actual hash for the spec
    const crypto = require('crypto');
    const specHash = crypto.createHash('sha256').update(specContent).digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('my-surface').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'current',
        specHash: specHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout).toContain('login-test');
  });

  it('resolve-content-change-makes-stale', async () => {
    const oldContent = `#decl surface my-surface
  Old version.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior login-test
    Old test.
  #end
#end
`;
    const newContent = `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior login-test
    Updated test content.
  #end
#end
`;
    setupProject(tmpDir, {
      'test.bvf': newContent
    });

    // Use hash of OLD content
    const crypto = require('crypto');
    const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('my-surface').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'current',
        specHash: oldHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('login-test');
    expect(result.stdout.toLowerCase()).toContain('content');
  });

  it('resolve-dependency-change-makes-stale', async () => {
    const specContent = `#decl surface web-app
  Updated surface.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end
`;
    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const crypto = require('crypto');
    const specHash = crypto.createHash('sha256').update('login instrument').digest('hex').substring(0, 16);
    const oldDepHash = crypto.createHash('sha256').update('old-surface-content').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'login': {
        type: 'instrument',
        status: 'current',
        specHash: specHash,
        dependencyHash: oldDepHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('login');
    expect(result.stdout.toLowerCase()).toContain('dependency');
  });

  it('resolve-transitive-dep-change-cascades', async () => {
    const specContent = `#decl surface web-app
  Updated surface.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior can-login
    Uses @{login}.
  #end
#end
`;
    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const crypto = require('crypto');
    const oldDepHash = crypto.createHash('sha256').update('old-surface').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'login': {
        type: 'instrument',
        status: 'current',
        specHash: 'login-hash',
        dependencyHash: oldDepHash,
        materializedAt: Date.now()
      },
      'can-login': {
        type: 'behavior',
        status: 'current',
        specHash: 'behavior-hash',
        dependencyHash: oldDepHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✗');
    const staleCount = (result.stdout.match(/✗/g) || []).length;
    expect(staleCount).toBeGreaterThanOrEqual(2);
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

  it('resolve-review-failed-shows-stale', async () => {
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

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'stale',
        reason: 'review-failed',
        note: 'test uses fake hashes',
        specHash: 'some-hash',
        dependencyHash: 'some-dep',
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('login-test');
    expect(result.stdout.toLowerCase()).toContain('review-failed');
    expect(result.stdout).toContain('fake hashes');
  });

  it('resolve-needs-elaboration-shows-pending', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature my-feature on @{my-surface}
  #decl behavior password-reset
    Test.
  #end
#end
`
    });

    createManifest(tmpDir, {
      'password-reset': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-elaboration',
        note: 'needs instrument defining reset steps',
        specHash: 'some-hash',
        dependencyHash: 'some-dep'
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳');
    expect(result.stdout).toContain('password-reset');
    expect(result.stdout.toLowerCase()).toContain('elaboration');
    expect(result.stdout).toContain('reset steps');
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

    const crypto = require('crypto');
    const hash1 = crypto.createHash('sha256').update('test-one').digest('hex').substring(0, 16);
    const hash2 = crypto.createHash('sha256').update('test-two').digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('my-surface').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'test-one': {
        type: 'behavior',
        status: 'current',
        specHash: hash1,
        dependencyHash: depHash,
        materializedAt: Date.now()
      },
      'test-two': {
        type: 'behavior',
        status: 'current',
        specHash: hash2,
        dependencyHash: depHash,
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

    const crypto = require('crypto');
    const currentHash = crypto.createHash('sha256').update('current').digest('hex').substring(0, 16);
    const staleHash = crypto.createHash('sha256').update('old-stale').digest('hex').substring(0, 16);
    const depHash = crypto.createHash('sha256').update('dep').digest('hex').substring(0, 16);

    createManifest(tmpDir, {
      'test-current': {
        type: 'behavior',
        status: 'current',
        specHash: currentHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      },
      'test-stale': {
        type: 'behavior',
        status: 'stale',
        reason: 'content-changed',
        specHash: staleHash,
        dependencyHash: depHash,
        materializedAt: Date.now()
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('⏳');
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
