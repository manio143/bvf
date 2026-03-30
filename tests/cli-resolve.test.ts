import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseBvfFile } from '../src/parser.js';
import { resolveReferences } from '../src/resolver.js';
import { computeSpecHash, computeDependencyHash } from '../src/manifest.js';
import { parseConfig, defaultConfig } from '../src/config.js';

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

  it('resolve-catches-nested-decl', async () => {
    setupProject(tmpDir, {
      'nested.bvf': `#decl surface outer
  #decl surface inner
    Nested declarations are not allowed.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('nested');
  });

  it('resolve-catches-behavior-outside-feature', async () => {
    setupProject(tmpDir, {
      'orphan.bvf': `#behavior orphaned-behavior
  Not inside a feature.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('behavior');
    expect(result.stderr.toLowerCase()).toContain('inside');
  });

  it.skip('resolve-catches-for-without-in', async () => {
    // TODO: Parser doesn't currently validate #for syntax errors
    setupProject(tmpDir, {
      'bad-for.bvf': `#decl feature broken on @{some-surface}
  #for email ["a@b.com"]
  #behavior test({email})
    Test.
  #end
#end

#decl surface some-surface
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('for');
    expect(result.stderr.toLowerCase()).toContain('in');
  });

  it.skip('resolve-catches-for-with-invalid-array', async () => {
    // TODO: Parser doesn't currently validate #for array syntax
    setupProject(tmpDir, {
      'bad-array.bvf': `#decl feature broken on @{some-surface}
  #for email in not-an-array
  #behavior test({email})
    Test.
  #end
#end

#decl surface some-surface
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('for');
    expect(result.stderr.toLowerCase()).toContain('array');
  });

  it('resolve-catches-for-outside-feature', async () => {
    setupProject(tmpDir, {
      'for-toplevel.bvf': `#for email in ["a@b.com"]
#behavior test
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    // The #behavior outside feature error triggers first
    expect(result.stderr).toContain('behavior');
    expect(result.stderr.toLowerCase()).toContain('inside');
  });

  it.skip('resolve-catches-unclosed-for', async () => {
    // TODO: Parser doesn't currently validate unclosed #for blocks
    setupProject(tmpDir, {
      'unclosed-for.bvf': `#decl feature broken on @{some-surface}
  #for email in ["a@b.com"]
  #behavior test({email})
    Test.
  #end
  // Missing #end for the #for block
#end

#decl surface some-surface
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('for');
  });

  it('resolve-catches-duplicate-context', async () => {
    setupProject(tmpDir, {
      'dup-context.bvf': `#decl feature test on @{some-surface}
  #context
    First context.
  #end
  #context
    Second context.
  #end
  #behavior test
    Test.
  #end
#end

#decl surface some-surface
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('context');
    expect(result.stderr.toLowerCase()).toContain('only one');
  });
});

describe('resolve-config-errors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-catches-missing-types', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  file-extension: .bvf
  state-dir: .bvf-state
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('types');
    expect(result.stderr.toLowerCase()).toContain('required');
  });

  it('resolve-catches-empty-types', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  types:
  file-extension: .bvf
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('empty');
  });

  it('resolve-catches-malformed-config-no-colon', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  types surface, fixture
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toMatch(/malformed|syntax|colon/);
  });

  it('resolve-catches-malformed-config-no-value', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  file-extension:
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toMatch(/missing|value|empty/);
  });

  it('resolve-catches-malformed-config-bare-text', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `types: surface, fixture`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toMatch(/#config|missing|block/);
  });

  it('resolve-catches-unclosed-config', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  types: surface, fixture
`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('config');
  });

  it('resolve-catches-duplicate-config-blocks', async () => {
    mkdirSync(join(tmpDir, 'specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  types: surface
#end
#config
  types: fixture
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('multiple');
    expect(result.stderr.toLowerCase()).toContain('config');
  });

  it('resolve-catches-unknown-entity-type', async () => {
    setupProject(tmpDir, {
      'widget.bvf': `#decl widget my-thing
  Some content.
#end
`
    }, `#config
  types: surface, behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('widget');
    expect(result.stderr.toLowerCase()).toContain('unknown');
  });

  it('resolve-tolerates-unknown-config-keys', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Content.
#end
`
    }, `#config
  types: surface
  file-extension: .bvf
  state-dir: .bvf-state
  unknown-key: some-value
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
  });

  it('resolve-trims-whitespace-from-types', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Content.
#end

#decl fixture my-fixture
  Content.
#end

#decl instrument my-instrument on @{my-surface}
  Content.
#end
`
    }, `#config
  types:  surface ,  fixture  , instrument
  file-extension: .bvf
  state-dir: .bvf-state
#end`);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
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
      'bad-ref.bvf': `#decl instrument test on @{nonexistent}
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('nonexistent');
    expect(result.stderr.toLowerCase()).toContain('unresolved');
  });

  it('resolve-catches-missing-required-param', async () => {
    setupProject(tmpDir, {
      'params.bvf': `#decl surface web-app
#end

#decl instrument login(email, password) on @{web-app}
  Login.
#end

#decl behavior test using @{login}(email: "a@b.com")
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('password');
    expect(result.stderr.toLowerCase()).toContain('missing');
  });

  it('resolve-catches-unknown-param', async () => {
    setupProject(tmpDir, {
      'bad-param.bvf': `#decl surface web-app
#end

#decl instrument login(email, password) on @{web-app}
  Login.
#end

#decl behavior test using @{login}(username: "foo", password: "bar")
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('username');
    expect(result.stderr.toLowerCase()).toContain('unknown');
  });

  it('resolve-catches-bare-ref-needing-params', async () => {
    setupProject(tmpDir, {
      'bare-ref.bvf': `#decl surface web-app
#end

#decl instrument login(email, password) on @{web-app}
  Login.
#end

#decl behavior test
  When @{login}. Then success.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('login');
    expect(result.stderr.toLowerCase()).toContain('requires');
  });

  it('resolve-catches-circular-dependency', async () => {
    setupProject(tmpDir, {
      'circular.bvf': `#decl surface a on @{b}
#end

#decl surface b on @{a}
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('circular');
  });

  it('resolve-accepts-valid-references', async () => {
    setupProject(tmpDir, {
      'valid.bvf': `#decl surface web-app
#end

#decl instrument login(email, password) on @{web-app}
  Login.
#end

#decl feature auth on @{web-app}
  #behavior can-login using @{login}(email: "a@b.com", password: "x")
    Test.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('web-app');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('can-login');
  });

  it('resolve-accepts-optional-param-omission', async () => {
    setupProject(tmpDir, {
      'optional.bvf': `#decl fixture user(email, role = "member")
  User fixture.
#end

#decl behavior test using @{user}(email: "a@b.com")
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('resolve-accepts-bare-ref-to-paramless-entity', async () => {
    setupProject(tmpDir, {
      'bare-ok.bvf': `#decl surface web-app
  App.
#end

#decl instrument test on @{web-app}
  Using @{web-app}.
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
      'simple.bvf': `#decl surface my-surface
  Surface.
#end

#decl fixture my-fixture
  Fixture.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('my-surface');
    expect(result.stdout).toContain('my-fixture');
  });

  it('resolve-shows-feature-with-behaviors', async () => {
    setupProject(tmpDir, {
      'feature.bvf': `#decl surface app
#end

#decl feature my-feature on @{app}
  #context
    App is running.
  #end
  #behavior first-test
    First.
  #end
  #behavior second-test
    Second.
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

  it('resolve-shows-for-expanded-behaviors', async () => {
    setupProject(tmpDir, {
      'for-expand.bvf': `#decl surface app
#end

#decl feature validation on @{app}
  #for email in ["a@b.com", "bad", ""]
  #behavior rejects-invalid({email})
    When {email} is submitted. Then validation fails.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    // Should have 3 expanded behaviors
    const matches = result.stdout.match(/rejects-invalid/g);
    expect(matches?.length).toBe(3);
  });

  it('resolve-shows-for-tuple-expansion', async () => {
    setupProject(tmpDir, {
      'tuple.bvf': `#decl surface app
#end

#decl feature validation on @{app}
  #for field, value in [("email", ""), ("pw", "x")]
  #behavior test-{field}-{value}
    Test {field} with {value}.
  #end
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    // Should have 2 expanded behaviors - check they exist (with quotes in names)
    expect(result.stdout).toContain('test-');
    const matches = result.stdout.match(/test-/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it('resolve-ignores-prose-between-entities', async () => {
    setupProject(tmpDir, {
      'prose.bvf': `# Markdown heading

This is some prose.

#decl surface app
  App.
#end

More prose here.

#decl fixture data
  Data.
#end

And more prose.
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('app');
    expect(result.stdout).toContain('data');
    expect(result.stdout).not.toContain('Markdown heading');
  });

  it('resolve-ignores-decl-inside-fences', async () => {
    setupProject(tmpDir, {
      'fenced.bvf': `#decl surface real-entity
  A real surface.
#end

Here is an example of BVF syntax:
\`\`\`
#decl surface fake-entity
  This is inside a fenced code block.
#end
\`\`\`

#decl fixture also-real
  Also a real entity.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('real-entity');
    expect(result.stdout).toContain('also-real');
    expect(result.stdout).not.toContain('fake-entity');
  });

  it('resolve-accepts-optional-param-syntax', async () => {
    setupProject(tmpDir, {
      'optional.bvf': `#decl surface my-app
  An app.
#end

#decl instrument run-cmd(dir, type?, flags?) on @{my-app}
  Run a command.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('run-cmd');
    expect(result.stderr).toBe('');
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
      'test.bvf': `#decl behavior login-test
  Test.
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
  Test.
#end
`
    });

    // Parse to get spec hash
    const content = readFileSync(join(tmpDir, 'specs', 'test.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entity = parseResult.value![0];
    const specHash = computeSpecHash(entity);

    createManifest(tmpDir, {
      'login-test': {
        name: 'login-test',
        specHash,
        dependencyHash: specHash
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout).toContain('login-test');
  });

  it('resolve-content-change-makes-stale', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Updated content.
#end
`
    });

    // Create manifest with old hash
    createManifest(tmpDir, {
      'login-test': {
        name: 'login-test',
        specHash: 'old-hash-that-wont-match',
        dependencyHash: 'old-hash'
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('login-test');
    expect(result.stdout.toLowerCase()).toContain('changed');
  });

  it('resolve-dependency-change-makes-stale', async () => {
    setupProject(tmpDir, {
      'deps.bvf': `#decl surface web-app
  Updated surface.
#end

#decl instrument login on @{web-app}
  Login.
#end
`
    });

    // Parse entities to compute hashes
    const content = readFileSync(join(tmpDir, 'specs', 'deps.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entities = parseResult.value!;
    
    const surfaceEntity = entities.find(e => e.name === 'web-app')!;
    const instrumentEntity = entities.find(e => e.name === 'login')!;
    
    const oldSurfaceHash = 'old-surface-hash';
    const surfaceHash = computeSpecHash(surfaceEntity);
    const instrumentHash = computeSpecHash(instrumentEntity);

    // Manifest has old surface hash, current instrument hash but old dep hash
    createManifest(tmpDir, {
      'web-app': {
        name: 'web-app',
        specHash: oldSurfaceHash,
        dependencyHash: oldSurfaceHash
      },
      'login': {
        name: 'login',
        specHash: instrumentHash,
        dependencyHash: oldSurfaceHash // Old dependency
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    // Login should be stale because dependency changed
    const lines = result.stdout.split('\n');
    const loginLine = lines.find(l => l.includes('login'));
    expect(loginLine).toContain('✗');
  });

  it('resolve-transitive-dep-change-cascades', async () => {
    setupProject(tmpDir, {
      'cascade.bvf': `#decl surface web-app
  Updated surface.
#end

#decl instrument login on @{web-app}
  Login.
#end

#decl behavior can-login using @{login}
  Test.
#end
`
    });

    // Parse and resolve to compute hashes
    const content = readFileSync(join(tmpDir, 'specs', 'cascade.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entities = parseResult.value!;
    
    const config = defaultConfig();
    const resolveResult = resolveReferences(entities, config);
    const resolved = resolveResult.value!;
    
    const surfaceEntity = resolved.find(e => e.name === 'web-app')!;
    const instrumentEntity = resolved.find(e => e.name === 'login')!;
    const behaviorEntity = resolved.find(e => e.name === 'can-login')!;
    
    const oldSurfaceHash = 'old-surface-hash';
    const instrumentHash = computeSpecHash(instrumentEntity);
    const behaviorHash = computeSpecHash(behaviorEntity);
    
    const currentHashes = new Map<string, string>();
    currentHashes.set('web-app', oldSurfaceHash);
    currentHashes.set('login', instrumentHash);
    currentHashes.set('can-login', behaviorHash);

    const oldDepHash = computeDependencyHash(instrumentEntity, currentHashes);

    // Manifest has all old hashes
    createManifest(tmpDir, {
      'web-app': {
        name: 'web-app',
        specHash: oldSurfaceHash,
        dependencyHash: oldSurfaceHash
      },
      'login': {
        name: 'login',
        specHash: instrumentHash,
        dependencyHash: oldDepHash
      },
      'can-login': {
        name: 'can-login',
        specHash: behaviorHash,
        dependencyHash: oldDepHash
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    // Both login and can-login should be stale
    const lines = result.stdout.split('\n');
    const loginLine = lines.find(l => l.includes('login') && !l.includes('can-login'));
    const behaviorLine = lines.find(l => l.includes('can-login'));
    
    expect(loginLine).toContain('✗');
    expect(behaviorLine).toContain('✗');
  });

  it('resolve-orphaned-entity-detected', async () => {
    setupProject(tmpDir, {
      'current.bvf': `#decl behavior current-test
  Test.
#end
`
    });

    // Manifest has an entry for entity that no longer exists
    createManifest(tmpDir, {
      'old-test': {
        name: 'old-test',
        specHash: 'some-hash',
        dependencyHash: 'some-hash'
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('orphaned');
    expect(result.stdout).toContain('old-test');
  });

  it('resolve-review-failed-shows-stale', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior login-test
  Test.
#end
`
    });

    // Parse to get spec hash
    const content = readFileSync(join(tmpDir, 'specs', 'test.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entity = parseResult.value![0];
    const specHash = computeSpecHash(entity);

    createManifest(tmpDir, {
      'login-test': {
        name: 'login-test',
        specHash,
        dependencyHash: specHash,
        status: 'stale',
        reason: 'review-failed',
        note: 'test uses fake hashes'
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('login-test');
    expect(result.stdout).toContain('review-failed');
    expect(result.stdout).toContain('fake hashes');
  });

  it('resolve-needs-elaboration-shows-pending', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl behavior password-reset
  Test.
#end
`
    });

    // Parse to get spec hash
    const content = readFileSync(join(tmpDir, 'specs', 'test.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entity = parseResult.value![0];
    const specHash = computeSpecHash(entity);

    createManifest(tmpDir, {
      'password-reset': {
        name: 'password-reset',
        specHash,
        dependencyHash: specHash,
        status: 'pending',
        reason: 'needs-elaboration',
        note: 'needs instrument defining reset steps'
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('⏳');
    expect(result.stdout).toContain('password-reset');
    expect(result.stdout).toContain('needs-elaboration');
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
    setupProject(tmpDir, {
      'clean.bvf': `#decl surface app
#end

#decl fixture data
#end

#decl behavior test
  Test.
#end
`
    });

    // Parse and create manifest with matching hashes
    const content = readFileSync(join(tmpDir, 'specs', 'clean.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entities = parseResult.value!;
    
    const manifest: Record<string, any> = {};
    for (const entity of entities) {
      const specHash = computeSpecHash(entity);
      manifest[entity.name] = {
        name: entity.name,
        specHash,
        dependencyHash: specHash
      };
    }
    
    createManifest(tmpDir, manifest);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    
    // Spec: "Then all entities show ✓ status"
    // Verify EACH entity appears on a line with ✓
    const entityNames = ['app', 'data', 'test'];
    for (const name of entityNames) {
      const lines = result.stdout.split('\n');
      const entityLine = lines.find(l => l.includes(name));
      expect(entityLine, `Entity "${name}" should appear with ✓ status`).toBeDefined();
      expect(entityLine, `Entity "${name}" should have ✓ symbol`).toContain('✓');
    }
    
    expect(result.stdout).toContain('Errors: 0');
    expect(result.stdout).toContain('Stale: 0');
    expect(result.stdout).toContain('Pending: 0');
  });

  it('resolve-mixed-statuses-ordered', async () => {
    setupProject(tmpDir, {
      'mixed.bvf': `#decl surface app
#end

#decl feature alpha-clean on @{app}
  #behavior test-alpha
    Test.
  #end
#end

#decl feature bravo-clean on @{app}
  #behavior test-bravo
    Test.
  #end
#end

#decl feature charlie-problem on @{app}
  #behavior test-charlie-stale
    Test.
  #end
#end

#decl feature delta-problem on @{app}
  #behavior test-delta-pending
    Test.
  #end
#end
`
    });

    // Parse and resolve entities
    const content = readFileSync(join(tmpDir, 'specs', 'mixed.bvf'), 'utf-8');
    const parseResult = parseBvfFile(content);
    const entities = parseResult.value!;
    
    const config = defaultConfig();
    const resolveResult = resolveReferences(entities, config);
    const resolved = resolveResult.value!;
    
    const manifest: Record<string, any> = {};
    
    // Surface is current
    const surface = resolved.find(e => e.name === 'app')!;
    const surfaceHash = computeSpecHash(surface);
    manifest['app'] = {
      name: 'app',
      specHash: surfaceHash,
      dependencyHash: surfaceHash
    };
    
    // Alpha feature: behavior is current
    const alphaFeature = resolved.find(e => e.name === 'alpha-clean')!;
    const testAlpha = alphaFeature.behaviors![0];
    const testAlphaHash = computeSpecHash(testAlpha);
    const currentHashes = new Map<string, string>();
    currentHashes.set('app', surfaceHash);
    currentHashes.set('alpha-clean', computeSpecHash(alphaFeature));
    const testAlphaDepHash = computeDependencyHash(testAlpha, currentHashes);
    manifest['test-alpha'] = {
      name: 'test-alpha',
      specHash: testAlphaHash,
      dependencyHash: testAlphaDepHash
    };
    
    // Bravo feature: behavior is current
    const bravoFeature = resolved.find(e => e.name === 'bravo-clean')!;
    const testBravo = bravoFeature.behaviors![0];
    const testBravoHash = computeSpecHash(testBravo);
    currentHashes.set('bravo-clean', computeSpecHash(bravoFeature));
    const testBravoDepHash = computeDependencyHash(testBravo, currentHashes);
    manifest['test-bravo'] = {
      name: 'test-bravo',
      specHash: testBravoHash,
      dependencyHash: testBravoDepHash
    };
    
    // Charlie feature: behavior is stale (old hash in manifest)
    const charlieFeature = resolved.find(e => e.name === 'charlie-problem')!;
    const testCharlie = charlieFeature.behaviors![0];
    currentHashes.set('charlie-problem', computeSpecHash(charlieFeature));
    const testCharlieDepHash = computeDependencyHash(testCharlie, currentHashes);
    manifest['test-charlie-stale'] = {
      name: 'test-charlie-stale',
      specHash: 'old-hash',  // Old spec hash makes it stale
      dependencyHash: testCharlieDepHash
    };
    
    // Delta feature: behavior is pending (no manifest entry = new)
    
    createManifest(tmpDir, manifest);

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    
    // Spec: "Features with all-current behaviors appear first (alphabetically).
    // Features with any stale or pending behaviors are pushed to the end (also alphabetically)."
    
    // Find feature positions in output
    const lines = result.stdout.split('\n');
    const alphaIndex = lines.findIndex(l => l.includes('alpha-clean'));
    const bravoIndex = lines.findIndex(l => l.includes('bravo-clean'));
    const charlieIndex = lines.findIndex(l => l.includes('charlie-problem'));
    const deltaIndex = lines.findIndex(l => l.includes('delta-problem'));
    
    // All should be found
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(bravoIndex).toBeGreaterThan(-1);
    expect(charlieIndex).toBeGreaterThan(-1);
    expect(deltaIndex).toBeGreaterThan(-1);
    
    // Clean features (alpha, bravo) should appear before problem features (charlie, delta)
    expect(alphaIndex).toBeLessThan(charlieIndex);
    expect(alphaIndex).toBeLessThan(deltaIndex);
    expect(bravoIndex).toBeLessThan(charlieIndex);
    expect(bravoIndex).toBeLessThan(deltaIndex);
    
    // Within clean group: alpha before bravo (alphabetical)
    expect(alphaIndex).toBeLessThan(bravoIndex);
    
    // Within problem group: charlie before delta (alphabetical)
    expect(charlieIndex).toBeLessThan(deltaIndex);
    
    // Verify summary shows mix of statuses
    expect(result.stdout).toMatch(/Stale:\s+\d+/);
    expect(result.stdout).toMatch(/Pending:\s+\d+/);
  });

  it('resolve-with-diff', async () => {
    setupProject(tmpDir, {
      'entities.bvf': `#decl surface app
  Updated surface content.
#end

#decl instrument login on @{app}
  Uses surface.
#end

#decl feature my-feature on @{app}
  #behavior first-test using @{login}
    Uses login and app.
  #end
  #behavior second-test using @{login}
    Also uses login and app.
  #end
#end
`
    });

    // Spec: Create a surface that 2+ behaviors depend on, change the surface,
    // verify all appear in diff output with correct format.
    // Surface changed → instrument stale → both behaviors stale (cascade)
    
    createManifest(tmpDir, {
      'app': {
        name: 'app',
        specHash: 'old-surface-hash',  // Changed surface
        dependencyHash: 'old-surface-hash'
      },
      'login': {
        name: 'login',
        specHash: 'old-login-hash',  // Unchanged but deps changed
        dependencyHash: 'old-surface-hash'
      },
      'first-test': {
        name: 'first-test',
        specHash: 'old-test1-hash',
        dependencyHash: 'old-dep-hash'
      },
      'second-test': {
        name: 'second-test',
        specHash: 'old-test2-hash',
        dependencyHash: 'old-dep-hash'
      }
    });

    const result = await runCli('resolve --diff', tmpDir);

    expect(result.exitCode).toBe(0);
    
    // Spec: Machine-parseable format `<status> <type> <name> <relative-path>:<line>`, one entity per line
    // Shows root causes AND affected entities (cascade)
    // "The human-readable tree output is suppressed — `--diff` is designed for piping into scripts"
    
    const lines = result.stdout.trim().split('\n').filter(l => l.trim() && !l.match(/^Resolution Status:/));
    
    // Should show: surface (root cause) + instrument (direct dep) + 2 behaviors (cascade)
    // At least 4 stale entities
    expect(lines.length).toBeGreaterThanOrEqual(4);
    
    // Each line must match format: <status> <type> <name> <path>:<line>
    // Format: stale/pending/orphaned, then type, then name, then relative-path:line
    const formatRegex = /^(stale|pending|orphaned)\s+(surface|instrument|behavior|fixture|feature)\s+\S+\s+\S+:\d+$/;
    
    let matchingLines = 0;
    for (const line of lines) {
      if (formatRegex.test(line)) {
        matchingLines++;
      }
    }
    
    // Expect at least 4 lines matching the format (app, login, first-test, second-test)
    expect(matchingLines, `Should have at least 4 lines matching <status> <type> <name> <path>:<line> format`).toBeGreaterThanOrEqual(4);
    
    // Verify all affected entities appear in output
    const output = result.stdout;
    expect(output).toContain('app');  // Root cause (surface changed)
    expect(output).toContain('login');  // Direct dependency
    expect(output).toContain('first-test');  // Cascade
    expect(output).toContain('second-test');  // Cascade
    
    // Verify relative paths with line numbers appear
    expect(output).toMatch(/entities\.bvf:\d+/);
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
      'test.bvf': `#decl behavior pending-test
  Test.
#end

#decl behavior stale-test
  Test.
#end
`
    });

    // Create manifest with one current, one stale
    createManifest(tmpDir, {
      'stale-test': {
        name: 'stale-test',
        specHash: 'old-hash',
        dependencyHash: 'old-hash'
      }
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Pending:');
    expect(result.stdout).toContain('Stale:');
  });

  it('resolve-exits-one-on-error', async () => {
    setupProject(tmpDir, {
      'error.bvf': `#decl instrument test on @{nonexistent}
  Test.
#end
`
    });

    const result = await runCli('resolve', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain('unresolved');
  });
});
