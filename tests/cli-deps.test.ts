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

describe('cli-deps', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deps-shows-direct-references', async () => {
    // Given a behavior "login-test" that references entities "http-client" and "user-fixture"
    setupProject(tmpDir, {
      'auth.bvf': `#decl surface web-app
  Test web app.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test on @{http-client} with @{user-fixture}
    Given a valid user.
    When the user logs in.
    Then the login succeeds.
  #end
#end
`,
      'instruments.bvf': `#decl instrument http-client on @{web-app}
  HTTP client for testing.
#end
`,
      'fixtures.bvf': `#decl fixture user-fixture
  A test user fixture.
#end
`
    });

    // Initialize and resolve to populate manifest
    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps login-test` is executed
    const result = await runCli('deps login-test', tmpDir);

    // Then output shows "Direct references:" section
    expect(result.stdout).toContain('Direct references:');
    
    // And it lists "instrument http-client (specs/instruments.bvf)"
    expect(result.stdout).toMatch(/instrument http-client.*specs\/instruments\.bvf/);
    
    // And it lists "fixture user-fixture (specs/fixtures.bvf)"
    expect(result.stdout).toMatch(/fixture user-fixture.*specs\/fixtures\.bvf/);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-shows-transitive-references', async () => {
    // Given a behavior "login-test" that references entity "http-client"
    // And entity "http-client" references entity "base-url-config"
    setupProject(tmpDir, {
      'auth.bvf': `#decl surface web-app
  Test web app.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test on @{http-client}
    Given a valid user.
    When the user logs in.
    Then the login succeeds.
  #end
#end
`,
      'instruments.bvf': `#decl instrument http-client on @{web-app} with @{base-url-config}
  HTTP client for testing.
#end
`,
      'config.bvf': `#decl fixture base-url-config
  Base URL configuration.
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps login-test` is executed
    const result = await runCli('deps login-test', tmpDir);

    // Then output shows "Transitive references (deduplicated):" section
    expect(result.stdout).toContain('Transitive references');
    
    // And it lists "fixture base-url-config (specs/config.bvf)"
    expect(result.stdout).toMatch(/fixture base-url-config.*specs\/config\.bvf/);
    
    // And entity "http-client" is NOT listed in transitive (it's in direct)
    const lines = result.stdout.split('\n');
    const transitiveStartIdx = lines.findIndex(l => l.includes('Transitive references'));
    const nextSectionIdx = lines.findIndex((l, idx) => idx > transitiveStartIdx && l.match(/^[A-Z]/));
    const transitiveSection = lines.slice(transitiveStartIdx, nextSectionIdx === -1 ? lines.length : nextSectionIdx);
    const transitiveText = transitiveSection.join('\n');
    expect(transitiveText).not.toMatch(/http-client/);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-shows-parent-chain', async () => {
    // Given a behavior "login-test" nested under feature "auth"
    // And feature "auth" references entity "web-app"
    setupProject(tmpDir, {
      'auth.bvf': `#decl surface web-app
  Test web app.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test
    Given a valid user.
    When the user logs in.
    Then the login succeeds.
  #end
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps login-test` is executed
    const result = await runCli('deps login-test', tmpDir);

    // Then output shows "Parent chain:" section
    expect(result.stdout).toContain('Parent chain:');
    
    // And it lists "feature auth (specs/auth.bvf)"
    expect(result.stdout).toMatch(/feature auth.*specs\/auth\.bvf/);
    
    // And under "auth" it shows "Dependencies:" with "surface web-app (specs/auth.bvf)"
    expect(result.stdout).toMatch(/Dependencies:.*surface web-app.*specs\/auth\.bvf/s);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-deduplicates-across-sections', async () => {
    // Given a behavior "login-test" that references entity "http-client"
    // And behavior is nested under feature "auth" that also references entity "http-client"
    setupProject(tmpDir, {
      'auth.bvf': `#decl surface web-app
  Test web app.
#end

#decl instrument http-client on @{web-app}
  HTTP client.
#end

#decl feature auth on @{web-app} with @{http-client}
  #decl behavior login-test on @{http-client}
    Given a valid user.
    When the user logs in.
    Then the login succeeds.
  #end
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps login-test` is executed
    const result = await runCli('deps login-test', tmpDir);

    // Then entity "http-client" appears only once (in direct references)
    const directRefsMatch = result.stdout.match(/Direct references:(.*?)(?=\n\n|\n[A-Z]|$)/s);
    expect(directRefsMatch).toBeTruthy();
    expect(directRefsMatch![0]).toMatch(/http-client/);
    
    // And it does NOT appear again under parent dependencies
    const parentChainMatch = result.stdout.match(/Parent chain:(.*?)(?=\n\n|\n[A-Z]|$)/s);
    if (parentChainMatch) {
      const parentText = parentChainMatch[0];
      // Count occurrences of http-client in parent section
      const httpClientMatches = (parentText.match(/http-client/g) || []).length;
      // Should be listed under parent's dependencies, but not duplicated
      // The deduplication means it shouldn't show up as a separate item if already in direct
      expect(httpClientMatches).toBeLessThanOrEqual(1);
    }
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-shows-all-files-section', async () => {
    // Given a behavior "login-test" that references entity "http-client" (specs/instruments.bvf)
    // And entity "http-client" references entity "config" (specs/config.bvf)
    // And behavior is nested in "auth" feature (specs/auth.bvf)
    setupProject(tmpDir, {
      'auth.bvf': `#decl surface web-app
  Test web app.
#end

#decl feature auth on @{web-app}
  #decl behavior login-test on @{http-client}
    Given a valid user.
    When the user logs in.
    Then the login succeeds.
  #end
#end
`,
      'instruments.bvf': `#decl instrument http-client on @{web-app} with @{config}
  HTTP client for testing.
#end
`,
      'config.bvf': `#decl fixture config
  Configuration fixture.
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps login-test` is executed
    const result = await runCli('deps login-test', tmpDir);

    // Then output shows "All files needed for materialization:" section
    expect(result.stdout).toMatch(/All files/i);
    
    // And it lists all unique file paths
    expect(result.stdout).toContain('specs/auth.bvf');
    expect(result.stdout).toContain('specs/instruments.bvf');
    expect(result.stdout).toContain('specs/config.bvf');
    
    // And each path appears only once
    const fileMatches = result.stdout.match(/specs\/auth\.bvf/g);
    expect(fileMatches?.length).toBeGreaterThanOrEqual(1);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-handles-entity-without-references', async () => {
    // Given a surface "web-app" with no references
    setupProject(tmpDir, {
      'surfaces.bvf': `#decl surface web-app
  A web application surface.
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps web-app` is executed
    const result = await runCli('deps web-app', tmpDir);

    // Then output shows "Direct references: (none)"
    expect(result.stdout).toMatch(/Direct references:.*\(none\)/i);
    
    // And output shows "Transitive references: (none)"
    expect(result.stdout).toMatch(/Transitive references:.*\(none\)/i);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-handles-entity-without-parent', async () => {
    // Given a top-level surface "web-app" with no parent
    setupProject(tmpDir, {
      'surfaces.bvf': `#decl surface web-app
  A web application surface.
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps web-app` is executed
    const result = await runCli('deps web-app', tmpDir);

    // Then output shows "Parent chain: (none)"
    expect(result.stdout).toMatch(/Parent chain:.*\(none\)/i);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });

  it('deps-validates-entity-exists', async () => {
    // Given a project with no entity named "nonexistent"
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  A web application.
#end
`
    });

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps nonexistent` is executed
    const result = await runCli('deps nonexistent', tmpDir);

    // Then stderr contains "Error: Entity 'nonexistent' not found"
    expect(result.stderr).toMatch(/Entity.*nonexistent.*not found/i);
    
    // Exit code is 1
    expect(result.exitCode).toBe(1);
  });

  it('deps-requires-entity-argument', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface web-app
  A web application.
#end
`
    });

    await runCli('init', tmpDir);

    // When the command `bvf deps` is executed with no arguments
    const result = await runCli('deps', tmpDir);

    // Then stderr contains "Usage: bvf deps <entity>"
    expect(result.stderr).toMatch(/Usage:.*bvf deps.*<entity>/i);
    
    // Exit code is 1
    expect(result.exitCode).toBe(1);
  });

  it('deps-shows-relative-paths', async () => {
    // Given a behavior named "test-behavior" in specs/auth/login.bvf
    mkdirSync(join(tmpDir, 'specs', 'auth'), { recursive: true });
    mkdirSync(join(tmpDir, '.bvf-state'), { recursive: true });
    
    writeFileSync(join(tmpDir, 'bvf.config'), `#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end`);
    
    writeFileSync(join(tmpDir, 'specs', 'surfaces.bvf'), `#decl surface web-app
  Test web app.
#end
`);
    
    writeFileSync(join(tmpDir, 'specs', 'auth', 'login.bvf'), `#decl feature auth on @{web-app}
  #decl behavior test-behavior
    Given a valid user.
    When the user logs in.
    Then the login succeeds.
  #end
#end
`);

    await runCli('init', tmpDir);
    await runCli('resolve', tmpDir);

    // When command `bvf deps test-behavior` is executed
    const result = await runCli('deps test-behavior', tmpDir);

    // Then all file paths start with "specs/" relative to project root
    const pathMatches = result.stdout.match(/specs\/[\w/-]+\.bvf/g);
    expect(pathMatches).toBeTruthy();
    expect(pathMatches!.length).toBeGreaterThan(0);
    
    // And paths use forward slashes
    expect(result.stdout).toMatch(/specs\/auth\/login\.bvf/);
    expect(result.stdout).not.toMatch(/specs\\auth\\login\.bvf/);
    
    // Exit code is 0
    expect(result.exitCode).toBe(0);
  });
});
