import type { BvfConfig, ConfigResult } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Parse a bvf.config file content
 */
export function parseConfig(content: string): ConfigResult {
  const errors: Error[] = [];
  
  // Check for #config line
  const hasConfigStart = content.includes('#config');
  if (!hasConfigStart) {
    return { ok: false, errors: [new Error('No #config block found')] };
  }
  
  // Find #config block
  const configBlocks = content.match(/#config[\s\S]*?#end/g);
  
  if (!configBlocks) {
    // Has #config but no matching #end
    return { ok: false, errors: [new Error('Unclosed #config block')] };
  }
  
  if (configBlocks.length > 1) {
    return { ok: false, errors: [new Error('Multiple #config blocks found - only one allowed')] };
  }
  
  const configBlock = configBlocks[0];
  const lines = configBlock.split('\n');
  
  // Check for #end
  const hasEnd = lines.some(l => l.trim() === '#end');
  if (!hasEnd) {
    return { ok: false, errors: [new Error('Unclosed #config block')] };
  }
  
  let types: string[] | undefined;
  let typeLines: string[] = [];
  let collectingTypes = false;
  let typesKeySeen = false;
  let fileExtension = '.bvf';
  let stateDir = '.bvf-state';
  let containment = new Map<string, string[]>();
  let inContainmentSection = false;
  let currentContainmentKey: string | null = null;
  let containmentLines: string[] = [];
  let materializable: string[] | undefined;
  let materializableLines: string[] = [];
  let collectingMaterializable = false;
  let materializableKeySeen = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '#config' || trimmed === '#end' || !trimmed) {
      continue;
    }
    
    // Check if line starts a key (could be top-level or containment)
    const keyMatch = trimmed.match(/^(\S+?):\s*(.*)$/);
    if (!keyMatch) {
      // Not a key:value line - could be continuation or syntax error
      if (collectingTypes) {
        typeLines.push(trimmed);
      } else if (collectingMaterializable) {
        materializableLines.push(trimmed);
      } else if (currentContainmentKey) {
        containmentLines.push(trimmed);
      } else {
        // Line has no colon and is not a continuation - syntax error
        return { ok: false, errors: [new Error(`syntax error: expected "key: value" format (line has no colon)`)] };
      }
      continue;
    }
    
    const [, key, valueStr] = keyMatch;
    
    // Check if this is a known top-level key
    const topLevelKeys = ['types', 'containment', 'materializable', 'file-extension', 'state-dir'];
    const isTopLevelKey = topLevelKeys.includes(key);
    
    // Finish any ongoing collections when we see a new key (top-level or unknown)
    if (collectingTypes && typeLines.length > 0) {
      types = typeLines.join(',')
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      typeLines = [];
      collectingTypes = false;
    } else if (collectingTypes && typeLines.length === 0 && typesKeySeen) {
      types = [];
      collectingTypes = false;
    }
    
    if (collectingMaterializable && materializableLines.length > 0) {
      materializable = materializableLines.join(',')
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      materializableLines = [];
      collectingMaterializable = false;
    } else if (collectingMaterializable && materializableLines.length === 0 && materializableKeySeen) {
      materializable = [];
      collectingMaterializable = false;
    }
    
    if (currentContainmentKey && containmentLines.length > 0) {
      const children = containmentLines.join(',')
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      containment.set(currentContainmentKey, children);
      containmentLines = [];
      currentContainmentKey = null;
    }
    
    if (isTopLevelKey) {
      switch (key) {
        case 'types':
          typesKeySeen = true;
          if (valueStr) {
            typeLines.push(valueStr);
          }
          collectingTypes = true;
          collectingMaterializable = false;
          inContainmentSection = false;
          break;
        case 'materializable':
          materializableKeySeen = true;
          if (valueStr) {
            materializableLines.push(valueStr);
          }
          collectingMaterializable = true;
          collectingTypes = false;
          inContainmentSection = false;
          break;
        case 'containment':
          inContainmentSection = true;
          collectingTypes = false;
          collectingMaterializable = false;
          if (valueStr && valueStr.trim()) {
            return { ok: false, errors: [new Error('containment must be a section with nested rules')] };
          }
          break;
        case 'file-extension':
          if (!valueStr.trim()) {
            return { ok: false, errors: [new Error('file-extension requires a value')] };
          }
          fileExtension = valueStr.trim();
          collectingTypes = false;
          collectingMaterializable = false;
          inContainmentSection = false;
          break;
        case 'state-dir':
          stateDir = valueStr.trim();
          collectingTypes = false;
          collectingMaterializable = false;
          inContainmentSection = false;
          break;
      }
    } else if (inContainmentSection) {
      // This is a containment rule like "feature: behavior"
      currentContainmentKey = key;
      if (valueStr) {
        containmentLines.push(valueStr);
      }
    } else {
      // Unknown key outside containment section - silently ignore
    }
  }
  
  // Finish collecting types if still ongoing
  if (collectingTypes) {
    if (typeLines.length > 0) {
      types = typeLines.join(',')
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
    } else if (typesKeySeen) {
      types = [];
    }
  }
  
  // Finish collecting materializable if still ongoing
  if (collectingMaterializable) {
    if (materializableLines.length > 0) {
      materializable = materializableLines.join(',')
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
    } else if (materializableKeySeen) {
      materializable = [];
    }
  }
  
  // Finish collecting containment if still ongoing
  if (currentContainmentKey && containmentLines.length > 0) {
    const children = containmentLines.join(',')
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);
    containment.set(currentContainmentKey, children);
  }
  
  // Validate required fields
  if (!types) {
    return { ok: false, errors: [new Error('types field is required in config')] };
  }
  
  if (types.length === 0) {
    return { ok: false, errors: [new Error('types cannot be empty')] };
  }
  
  // Validate containment references
  const typeSet = new Set(types);
  for (const [parent, children] of containment) {
    if (!typeSet.has(parent)) {
      return {
        ok: false,
        errors: [new Error(`containment references unknown type "${parent}"`)]
      };
    }
    for (const child of children) {
      if (!typeSet.has(child)) {
        return {
          ok: false,
          errors: [new Error(`containment references unknown type "${child}"`)]
        };
      }
    }
  }
  
  // Validate materializable references
  if (materializable) {
    for (const typeName of materializable) {
      if (!typeSet.has(typeName)) {
        return {
          ok: false,
          errors: [new Error(`materializable references unknown type "${typeName}"`)]
        };
      }
    }
  }
  
  return {
    ok: true,
    value: {
      types,
      containment: containment.size > 0 ? containment : undefined,
      materializable,
      fileExtension,
      stateDir
    }
  };
}

/**
 * Load config from a directory (looks for bvf.config)
 */
export function loadConfig(dirPath: string): ConfigResult {
  const configPath = join(dirPath, 'bvf.config');
  
  if (!existsSync(configPath)) {
    // Return default config
    return { ok: true, value: defaultConfig() };
  }
  
  try {
    const content = readFileSync(configPath, 'utf-8');
    return parseConfig(content);
  } catch (error: any) {
    return {
      ok: false,
      errors: [new Error(`Failed to read config: ${error.message}`)]
    };
  }
}

/**
 * Default BVF configuration
 */
export function defaultConfig(): BvfConfig {
  const containment = new Map<string, string[]>();
  containment.set('feature', ['behavior']);
  
  return {
    types: ['surface', 'fixture', 'instrument', 'behavior', 'feature'],
    containment,
    fileExtension: '.bvf',
    stateDir: '.bvf-state'
  };
}
