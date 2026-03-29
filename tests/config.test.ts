import { describe, it, expect } from 'vitest';
import { parseConfig, defaultConfig } from '../src/config.js';

// Type definitions
interface BvfConfig {
  types: string[];
  fileExtension: string;
  stateDir: string;
}

interface ConfigResult {
  ok: boolean;
  value?: BvfConfig;
  errors?: Error[];
}

describe('config-parsing', () => {
  it('parses-valid-config', () => {
    const content = `
#config
  types: surface, fixture, instrument, behavior, feature
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(true);
    expect(result.value).toBeDefined();
    expect(result.value!.types).toEqual([
      'surface',
      'fixture',
      'instrument',
      'behavior',
      'feature'
    ]);
    expect(result.value!.fileExtension).toBe('.bvf');
    expect(result.value!.stateDir).toBe('.bvf-state');
  });

  it('parses-config-with-custom-types', () => {
    const content = `
#config
  types: surface, fixture, instrument, behavior, feature, constraint
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(true);
    expect(result.value!.types).toContain('constraint');
    expect(result.value!.types).toHaveLength(6);
  });

  it('handles-multiline-types', () => {
    const content = `
#config
  types: surface,
         fixture,
         instrument,
         behavior,
         feature
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(true);
    expect(result.value!.types).toEqual([
      'surface',
      'fixture',
      'instrument',
      'behavior',
      'feature'
    ]);
  });

  it('provides-default-config', () => {
    const config = defaultConfig();

    expect(config.types).toContain('surface');
    expect(config.types).toContain('fixture');
    expect(config.types).toContain('instrument');
    expect(config.types).toContain('behavior');
    expect(config.types).toContain('feature');
    expect(config.fileExtension).toBe('.bvf');
    expect(config.stateDir).toBe('.bvf-state');
  });

  it('rejects-config-without-types', () => {
    const content = `
#config
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/types.*required/i);
  });

  it('rejects-malformed-config', () => {
    const content = `
#config
  types surface fixture
  file-extension .bvf
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('rejects-unclosed-config', () => {
    const content = `
#config
  types: surface, fixture
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/unclosed.*#config/i);
  });

  it('allows-custom-file-extension', () => {
    const content = `
#config
  types: behavior, feature
  file-extension: .spec
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(true);
    expect(result.value!.fileExtension).toBe('.spec');
  });

  it('allows-custom-state-dir', () => {
    const content = `
#config
  types: behavior, feature
  file-extension: .bvf
  state-dir: .bvf-cache
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(true);
    expect(result.value!.stateDir).toBe('.bvf-cache');
  });

  it('ignores-unknown-config-keys', () => {
    const content = `
#config
  types: surface, fixture
  file-extension: .bvf
  state-dir: .bvf-state
  unknown-key: some-value
  another-unknown: value
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    // Should parse successfully, ignoring unknown keys
    expect(result.ok).toBe(true);
    expect(result.value!.types).toEqual(['surface', 'fixture']);
  });

  it('trims-whitespace-from-types', () => {
    const content = `
#config
  types:  surface ,  fixture  , instrument
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(true);
    expect(result.value!.types).toEqual(['surface', 'fixture', 'instrument']);
  });

  it('rejects-duplicate-config-blocks', () => {
    const content = `
#config
  types: surface
  file-extension: .bvf
  state-dir: .bvf-state
#end

#config
  types: fixture
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/multiple.*#config/i);
  });

  it('rejects-empty-types-list', () => {
    const content = `
#config
  types:
  file-extension: .bvf
  state-dir: .bvf-state
#end
    `.trim();

    const result = parseConfig(content) as ConfigResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/types.*cannot be empty/i);
  });
});
