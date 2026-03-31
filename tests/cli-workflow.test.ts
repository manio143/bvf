import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { parseBvfFile } from '../src/parser.js';
import { resolveReferences } from '../src/resolver.js';
import { computeSpecHash, computeDependencyHash } from '../src/manifest.js';
import { defaultConfig } from '../src/config.js';

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

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Parse spec content and compute REAL hashes for entities (matches production behavior)
 */
function computeRealHashes(specContent: string): Map<string, { specHash: string; dependencyHash: string }> {
  const config = defaultConfig();
  const parseResult = parseBvfFile(specContent, config);
  if (!parseResult.ok || !parseResult.value) {
    throw new Error('Failed to parse spec content');
  }
  
  const entities = parseResult.value;
  const resolveResult = resolveReferences(entities, config);
  const resolved = resolveResult.ok ? resolveResult.value! : entities;
  
  // Flatten behaviors (copy transitiveDependencies from parent)
  const flatEntities: any[] = [];
  for (const entity of resolved) {
    flatEntities.push(entity);
    if (entity.behaviors) {
      for (const behavior of entity.behaviors) {
        flatEntities.push({
          ...behavior,
          type: 'behavior',
          transitiveDependencies: entity.transitiveDependencies || []
        });
      }
    }
  }
  
  // Compute spec hashes for all entities
  const specHashes = new Map<string, string>();
  for (const entity of flatEntities) {
    specHashes.set(entity.name, computeSpecHash(entity));
  }
  
  // Compute dependency hashes
  const result = new Map<string, { specHash: string; dependencyHash: string }>();
  for (const entity of flatEntities) {
    const specHash = specHashes.get(entity.name)!;
    const dependencyHash = computeDependencyHash(entity, specHashes);
    result.set(entity.name, { specHash, dependencyHash });
  }
  
  return result;
}

/**
 * Extract the complete entity declaration from spec content.
 * Returns the full "#decl ... #end" block for the given entity name.
 * This matches what the real CLI implementation would hash for dependency tracking.
 */
function extractEntityDeclaration(specContent: string, entityName: string): string {
  const lines = specContent.split('\n');
  let startIndex = -1;
  let depth = 0;
  const result: string[] = [];
  
  // Find the entity declaration
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check if this is the target entity's #decl line
    if (startIndex === -1 && trimmed.startsWith('#decl')) {
      // Extract entity name from #decl line
      // Pattern: #decl type name(...) ...
      const match = trimmed.match(/^#decl\s+[\w-]+\s+([\w-]+)/);
      if (match && match[1] === entityName) {
        startIndex = i;
        depth = 1;
        result.push(line);
        continue;
      }
    }
    
    // If we're inside the target entity
    if (startIndex !== -1) {
      result.push(line);
      
      // Track nested #decl and #end
      if (trimmed.startsWith('#decl')) {
        depth++;
      } else if (trimmed === '#end') {
        depth--;
        
        // Found the closing #end for our entity
        if (depth === 0) {
          return result.join('\n');
        }
      }
    }
  }
  
  throw new Error(`Entity "${entityName}" not found in spec content`);
}

describe('cli-workflow - mark commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mark-spec-needs-elaboration', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior password-reset
    Test reset flow.
  #end
#end
`
    });

    createManifest(tmpDir, {});

    const result = await runCli('mark password-reset spec-needs-elaboration --note "needs instrument defining reset steps"', tmpDir);

    expect(result.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['password-reset']).toBeDefined();
    expect(manifest['password-reset'].status).toBe('pending');
    expect(manifest['password-reset'].reason).toBe('needs-elaboration');
    expect(manifest['password-reset'].note).toBe('needs instrument defining reset steps');

    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('password-reset');
    expect(resolveResult.stdout).toMatch(/needs-elaboration|elaboration/i);
    expect(resolveResult.stdout).toContain('needs instrument defining reset steps');
  });

  it('mark-spec-reviewed', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior password-reset
    Test reset flow.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    createManifest(tmpDir, {});

    const result = await runCli('mark password-reset spec-reviewed', tmpDir);

    expect(result.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['password-reset']).toBeDefined();
    expect(manifest['password-reset'].status).toBe('pending');
    expect(manifest['password-reset'].reason).toBe('reviewed');
    expect(manifest['password-reset'].specHash).toBeDefined();
    expect(manifest['password-reset'].dependencyHash).toBeDefined();

    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('password-reset');
    expect(resolveResult.stdout).toMatch(/reviewed/i);
  });

  it('mark-test-ready', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    // First, mark as spec-reviewed (workflow requirement)
    const reviewResult = await runCli('mark login-test spec-reviewed', tmpDir);
    expect(reviewResult.exitCode).toBe(0);

    // Then mark as test-ready
    const result = await runCli('mark login-test test-ready --artifact "tests/login.test.ts"', tmpDir);

    expect(result.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('current');
    expect(manifest['login-test'].reason).toBe('needs-review');
    expect(manifest['login-test'].specHash).toBeDefined();
    expect(manifest['login-test'].dependencyHash).toBeDefined();
    expect(manifest['login-test'].artifact).toBe('tests/login.test.ts');
    expect(manifest['login-test'].materializedAt).toBeDefined();

    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout).toMatch(/needs-review/i);
  });

  it('mark-test-ready-requires-artifact', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    createManifest(tmpDir, {});

    const result = await runCli('mark login-test test-ready', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/artifact|--artifact/i);
  });

  it('mark-test-reviewed', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const hashes = computeRealHashes(specContent);
    const loginTestHashes = hashes.get('login-test')!;

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'current',
        reason: 'needs-review',
        specHash: loginTestHashes.specHash,
        dependencyHash: loginTestHashes.dependencyHash,
        artifact: 'tests/login.test.ts',
        materializedAt: Date.now()
      }
    });

    const result = await runCli('mark login-test test-reviewed', tmpDir);

    expect(result.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('current');
    expect(manifest['login-test'].reason).toBe('reviewed');

    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('✓');
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout).toMatch(/reviewed/i);
  });

  it('mark-test-needs-fixing', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const specHash = computeHash(specContent);
    const surfaceDecl = extractEntityDeclaration(specContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'current',
        reason: 'needs-review',
        specHash,
        dependencyHash: depHash,
        artifact: 'tests/login.test.ts',
        materializedAt: Date.now()
      }
    });

    const result = await runCli('mark login-test test-needs-fixing --note "test uses hardcoded values"', tmpDir);

    expect(result.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('reviewed');
    expect(manifest['login-test'].note).toBe('test uses hardcoded values');
    expect(manifest['login-test'].artifact).toBe('tests/login.test.ts'); // Preserved

    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('login-test');
    expect(resolveResult.stdout).toMatch(/reviewed/i);
    expect(resolveResult.stdout).toContain('test uses hardcoded values');
  });

  it('mark-nonexistent-entity', async () => {
    setupProject(tmpDir, {
      'test.bvf': `#decl surface my-surface
  Test.
#end
`
    });

    createManifest(tmpDir, {});

    const result = await runCli('mark nonexistent spec-needs-elaboration', tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found|nonexistent/i);
  });

  it('mark-updates-hashes-on-transition', async () => {
    const oldSpecContent = `#decl surface my-surface
  Old version.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Old test.
  #end
#end
`;

    const newSpecContent = `#decl surface my-surface
  New version.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    New test with changes.
  #end
#end
`;

    const oldHash = computeHash(oldSpecContent);

    setupProject(tmpDir, {
      'test.bvf': newSpecContent
    });

    createManifest(tmpDir, {
      'login-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-elaboration',
        specHash: oldHash,
        dependencyHash: computeHash('old-dep')
      }
    });

    const result = await runCli('mark login-test spec-reviewed', tmpDir);

    expect(result.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['login-test']).toBeDefined();
    expect(manifest['login-test'].specHash).not.toBe(oldHash);
    expect(manifest['login-test'].specHash).toBeDefined();
    expect(manifest['login-test'].dependencyHash).toBeDefined();
    expect(manifest['login-test'].status).toBe('pending');
    expect(manifest['login-test'].reason).toBe('reviewed');
  });

  it('mark-detects-stale-before-blessing', async () => {
    const oldSpecContent = `#decl surface my-surface
  Old version.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Old test.
  #end
#end
`;

    const newSpecContent = `#decl surface my-surface
  New version.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    New test with changes.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': newSpecContent
    });

    // Compute real hashes for OLD content
    // (simulate manifest being out of sync with current spec)
    const oldHashes = computeRealHashes(oldSpecContent);
    const authTestOldHashes = oldHashes.get('auth-test')!;

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-review',  // Changed from 'needs-elaboration' to test staleness detection
        specHash: authTestOldHashes.specHash,
        dependencyHash: authTestOldHashes.dependencyHash
      }
    });

    const result = await runCli('mark auth-test spec-reviewed', tmpDir);

    // Should warn or refuse to bless without validation
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/changed|resolve|stale/i);

    // With --force flag
    const forceResult = await runCli('mark auth-test spec-reviewed --force', tmpDir);
    expect(forceResult.exitCode).toBe(0);

    const manifest = readManifest(tmpDir);
    expect(manifest['auth-test'].specHash).not.toBe(authTestOldHashes.specHash);
  });

  it('mark-rejects-invalid-state-transition', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Test authentication.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    // Create manifest with NO entry for auth-test (never reviewed)
    // This represents a brand new entity that hasn't gone through soundness review
    createManifest(tmpDir, {});

    // Try to mark as test-ready without being reviewed first
    // Spec: mark-rejects-invalid-state-transition
    // Entity must be spec-reviewed before marking as test-ready
    const result = await runCli('mark auth-test test-ready --artifact "tests/auth.test.ts"', tmpDir);

    // Spec-compliant behavior: reject invalid state transition
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/cannot mark as test-ready.*must be spec-reviewed first/i);
  });
});

describe('cli-workflow - workflow integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('workflow-soundness-review-pass', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Test authentication.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const hashes = computeRealHashes(specContent);
    const authTestHashes = hashes.get('auth-test')!;

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-review',
        specHash: authTestHashes.specHash,
        dependencyHash: authTestHashes.dependencyHash
      }
    });

    // Soundness review passes
    const markResult = await runCli('mark auth-test spec-reviewed', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Resolve shows ready for materialization
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/reviewed/i);
  });

  it('workflow-soundness-review-fail', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Test authentication.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const hashes = computeRealHashes(specContent);
    const authTestHashes = hashes.get('auth-test')!;

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-review',
        specHash: authTestHashes.specHash,
        dependencyHash: authTestHashes.dependencyHash
      }
    });

    // Soundness review fails
    const markResult = await runCli('mark auth-test spec-needs-elaboration --note "clarify error handling"', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Resolve shows needs elaboration
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/needs-elaboration|elaboration/i);
    expect(resolveResult.stdout).toContain('clarify error handling');
  });

  it('workflow-elaboration-triggers-re-review', async () => {
    const oldSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Original spec.
  #end
#end
`;

    const newSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Edited spec addressing review feedback.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': oldSpecContent
    });

    const oldHash = computeHash(oldSpecContent);
    const surfaceDecl = extractEntityDeclaration(oldSpecContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-elaboration',
        specHash: oldHash,
        dependencyHash: depHash,
        note: 'clarify error handling'
      }
    });

    // Edit the spec
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), newSpecContent);

    // Run resolve
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);

    // Should auto-update to needs-review
    const manifest = readManifest(tmpDir);
    expect(manifest['auth-test'].status).toBe('pending');
    expect(manifest['auth-test'].reason).toBe('needs-review');

    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/needs-review/i);
  });

  it('workflow-materialization', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Test authentication.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const surfaceDecl = extractEntityDeclaration(specContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'reviewed',
        specHash: computeHash(specContent),
        dependencyHash: depHash
      }
    });

    // Materialization agent generates test
    const markResult = await runCli('mark auth-test test-ready --artifact "tests/auth.test.ts"', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Resolve shows test needs review
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/needs-review/i);
  });

  it('workflow-alignment-review-pass', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Test authentication.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const surfaceDecl = extractEntityDeclaration(specContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'current',
        reason: 'needs-review',
        specHash: computeHash(specContent),
        dependencyHash: depHash,
        artifact: 'tests/auth.test.ts',
        materializedAt: Date.now()
      }
    });

    // Alignment review passes
    const markResult = await runCli('mark auth-test test-reviewed', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Resolve shows complete
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('✓');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/reviewed/i);
  });

  it('workflow-alignment-review-fail', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Test authentication.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const surfaceDecl = extractEntityDeclaration(specContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'current',
        reason: 'needs-review',
        specHash: computeHash(specContent),
        dependencyHash: depHash,
        artifact: 'tests/auth.test.ts',
        materializedAt: Date.now()
      }
    });

    // Alignment review fails
    const markResult = await runCli('mark auth-test test-needs-fixing --note "test doesn\'t handle edge case"', tmpDir);
    expect(markResult.exitCode).toBe(0);

    // Resolve shows needs rematerialization
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);
    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/reviewed/i);
    expect(resolveResult.stdout).toContain("test doesn't handle edge case");

    const manifest = readManifest(tmpDir);
    expect(manifest['auth-test'].status).toBe('pending');
    expect(manifest['auth-test'].reason).toBe('reviewed');
  });

  it('workflow-staleness-auto-restart', async () => {
    const oldSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Original spec.
  #end
#end
`;

    const newSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Edited spec with new requirements.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': oldSpecContent
    });

    const oldHash = computeHash(oldSpecContent);
    const surfaceDecl = extractEntityDeclaration(oldSpecContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'current',
        reason: 'reviewed',
        specHash: oldHash,
        dependencyHash: depHash,
        artifact: 'tests/auth.test.ts',
        materializedAt: Date.now()
      }
    });

    // Edit the spec
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), newSpecContent);

    // Run resolve
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);

    // Should auto-restart workflow
    const manifest = readManifest(tmpDir);
    expect(manifest['auth-test'].status).toBe('pending');
    expect(manifest['auth-test'].reason).toBe('needs-review');
    expect(manifest['auth-test'].artifact).toBe('tests/auth.test.ts'); // Preserved

    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/needs-review/i);
  });

  it('workflow-dependency-change-cascade', async () => {
    const oldSpecContent = `#decl surface web-app
  Original app spec.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior auth-test
    Uses @{login}.
  #end
#end
`;

    const newSpecContent = `#decl surface web-app
  Edited app spec with breaking changes.
#end

#decl instrument login on @{web-app}
  Login instrument.
#end

#decl feature auth on @{web-app}
  #decl behavior auth-test
    Uses @{login}.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': oldSpecContent
    });

    // Extract full declaration blocks for each entity
    const oldWebAppDecl = extractEntityDeclaration(oldSpecContent, 'web-app');
    const oldWebAppHash = computeHash(oldWebAppDecl);
    
    const oldLoginDecl = extractEntityDeclaration(oldSpecContent, 'login');
    const oldLoginHash = computeHash(oldLoginDecl);
    
    // For auth-test, compute combined dependency hash (web-app + login)
    const oldAuthTestDepHash = computeHash(oldWebAppHash + oldLoginHash);

    createManifest(tmpDir, {
      'web-app': {
        type: 'surface',
        status: 'current',
        reason: 'reviewed',
        specHash: oldWebAppHash,
        dependencyHash: computeHash(''),
        artifact: 'src/app.ts',
        materializedAt: Date.now()
      },
      'login': {
        type: 'instrument',
        status: 'current',
        reason: 'reviewed',
        specHash: oldLoginHash,
        dependencyHash: oldWebAppHash,
        artifact: 'tests/helpers/login.ts',
        materializedAt: Date.now()
      },
      'auth-test': {
        type: 'behavior',
        status: 'current',
        reason: 'reviewed',
        specHash: computeHash(extractEntityDeclaration(oldSpecContent, 'auth-test')),
        dependencyHash: oldAuthTestDepHash,
        artifact: 'tests/auth.test.ts',
        materializedAt: Date.now()
      }
    });

    // Edit the web-app surface
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), newSpecContent);

    // Run resolve
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);

    // All should cascade to needs-review
    const manifest = readManifest(tmpDir);
    expect(manifest['web-app'].status).toBe('pending');
    expect(manifest['web-app'].reason).toBe('needs-review');
    expect(manifest['login'].status).toBe('pending');
    expect(manifest['login'].reason).toBe('needs-review');
    expect(manifest['auth-test'].status).toBe('pending');
    expect(manifest['auth-test'].reason).toBe('needs-review');

    expect(resolveResult.stdout).toContain('web-app');
    expect(resolveResult.stdout).toContain('login');
    expect(resolveResult.stdout).toContain('auth-test');
  });
});

describe('cli-workflow - resolve displays workflow states', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bvf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolve-displays-workflow-reason-states', async () => {
    const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior spec-a
    Test A.
  #end
  #decl behavior spec-b
    Test B.
  #end
  #decl behavior spec-c
    Test C.
  #end
  #decl behavior spec-d
    Test D.
  #end
  #decl behavior spec-e
    Test E.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': specContent
    });

    const hashes = computeRealHashes(specContent);

    createManifest(tmpDir, {
      'spec-a': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-review',
        specHash: hashes.get('spec-a')!.specHash,
        dependencyHash: hashes.get('spec-a')!.dependencyHash
      },
      'spec-b': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-elaboration',
        specHash: hashes.get('spec-b')!.specHash,
        dependencyHash: hashes.get('spec-b')!.dependencyHash,
        note: 'needs clarification'
      },
      'spec-c': {
        type: 'behavior',
        status: 'pending',
        reason: 'reviewed',
        specHash: hashes.get('spec-c')!.specHash,
        dependencyHash: hashes.get('spec-c')!.dependencyHash
      },
      'spec-d': {
        type: 'behavior',
        status: 'current',
        reason: 'needs-review',
        specHash: hashes.get('spec-d')!.specHash,
        dependencyHash: hashes.get('spec-d')!.dependencyHash,
        artifact: 'tests/spec-d.test.ts',
        materializedAt: Date.now()
      },
      'spec-e': {
        type: 'behavior',
        status: 'current',
        reason: 'reviewed',
        specHash: hashes.get('spec-e')!.specHash,
        dependencyHash: hashes.get('spec-e')!.dependencyHash,
        artifact: 'tests/spec-e.test.ts',
        materializedAt: Date.now()
      }
    });

    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);

    // All should display with reason in brackets
    expect(resolveResult.stdout).toContain('spec-a');
    expect(resolveResult.stdout).toContain('spec-b');
    expect(resolveResult.stdout).toContain('spec-c');
    expect(resolveResult.stdout).toContain('spec-d');
    expect(resolveResult.stdout).toContain('spec-e');

    // Check status symbols
    expect(resolveResult.stdout).toMatch(/⏳.*spec-a.*needs-review/is);
    expect(resolveResult.stdout).toMatch(/⏳.*spec-b.*needs-elaboration/is);
    expect(resolveResult.stdout).toMatch(/⏳.*spec-c.*reviewed/is);
    expect(resolveResult.stdout).toMatch(/⏳.*spec-d.*needs-review/is);
    expect(resolveResult.stdout).toMatch(/✓.*spec-e.*reviewed/is);

    // spec-b should show note
    expect(resolveResult.stdout).toContain('needs clarification');
  });

  it('resolve-writes-manifest-on-auto-transition', async () => {
    const oldSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Original spec.
  #end
#end
`;

    const newSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Edited spec.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': oldSpecContent
    });

    const oldHash = computeHash(oldSpecContent);
    const surfaceDecl = extractEntityDeclaration(oldSpecContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'pending',
        reason: 'needs-elaboration',
        specHash: oldHash,
        dependencyHash: depHash
      }
    });

    // Edit the spec
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), newSpecContent);

    // Run resolve
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);

    // Manifest should be updated
    const manifest = readManifest(tmpDir);
    expect(manifest['auth-test'].specHash).not.toBe(oldHash);
    expect(manifest['auth-test'].specHash).toBeDefined();
    expect(manifest['auth-test'].dependencyHash).toBeDefined();
    expect(manifest['auth-test'].reason).toBe('needs-review');

    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/needs-review/i);
  });

  it('resolve-preserves-artifact-on-staleness', async () => {
    const oldSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Original spec.
  #end
#end
`;

    const newSpecContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior auth-test
    Edited spec with new requirements.
  #end
#end
`;

    setupProject(tmpDir, {
      'test.bvf': oldSpecContent
    });

    const oldHash = computeHash(oldSpecContent);
    const surfaceDecl = extractEntityDeclaration(oldSpecContent, 'my-surface');
    const depHash = computeHash(surfaceDecl);

    createManifest(tmpDir, {
      'auth-test': {
        type: 'behavior',
        status: 'current',
        reason: 'reviewed',
        specHash: oldHash,
        dependencyHash: depHash,
        artifact: 'tests/auth.test.ts',
        materializedAt: Date.now() - 10000
      }
    });

    // Edit the spec
    writeFileSync(join(tmpDir, 'specs', 'test.bvf'), newSpecContent);

    // Run resolve
    const resolveResult = await runCli('resolve', tmpDir);
    expect(resolveResult.exitCode).toBe(0);

    // Artifact should be preserved
    const manifest = readManifest(tmpDir);
    expect(manifest['auth-test'].artifact).toBe('tests/auth.test.ts');
    expect(manifest['auth-test'].status).toBe('pending');
    expect(manifest['auth-test'].reason).toBe('needs-review');

    expect(resolveResult.stdout).toContain('⏳');
    expect(resolveResult.stdout).toContain('auth-test');
    expect(resolveResult.stdout).toMatch(/needs-review/i);
  });
});
