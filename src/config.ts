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
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '#config' || trimmed === '#end' || !trimmed) {
      continue;
    }
    
    // Check if line starts a key (could be top-level or containment)
    const keyMatch = trimmed.match(/^(\S+?):\s*(.*)$/);
    if (!keyMatch) {
      // Not a key:value line - must be continuation
      if (collectingTypes) {
        typeLines.push(trimmed);
      } else if (currentContainmentKey) {
        containmentLines.push(trimmed);
      }
      continue;
    }
    
    const [, key, valueStr] = keyMatch;
    
    // Check if this is a known top-level key
    const topLevelKeys = ['types', 'containment', 'file-extension', 'state-dir'];
    const isTopLevelKey = topLevelKeys.includes(key);
    
    if (isTopLevelKey) {
      // This is a top-level key - finish any ongoing collections
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
      
      if (currentContainmentKey && containmentLines.length > 0) {
        const children = containmentLines.join(',')
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0);
        containment.set(currentContainmentKey, children);
        containmentLines = [];
        currentContainmentKey = null;
      }
      
      // Handle the top-level key
      switch (key) {
        case 'types':
          typesKeySeen = true;
          if (valueStr) {
            typeLines.push(valueStr);
          }
          collectingTypes = true;
          inContainmentSection = false;
          break;
        case 'containment':
          inContainmentSection = true;
          collectingTypes = false;
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
          inContainmentSection = false;
          break;
        case 'state-dir':
          stateDir = valueStr.trim();
          collectingTypes = false;
          inContainmentSection = false;
          break;
      }
    } else if (inContainmentSection) {
      // This is a containment rule like "feature: behavior"
      // Save previous containment entry if any
      if (currentContainmentKey && containmentLines.length > 0) {
        const children = containmentLines.join(',')
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0);
        containment.set(currentContainmentKey, children);
        containmentLines = [];
      }
      
      currentContainmentKey = key;
      if (valueStr) {
        containmentLines.push(valueStr);
      }
    } else {
      // Unknown key outside containment section - ignore it
      collectingTypes = false;
      inContainmentSection = false;
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
  
  return {
    ok: true,
    value: {
      types,
      containment: containment.size > 0 ? containment : undefined,
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
