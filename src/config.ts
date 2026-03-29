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
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '#config' || trimmed === '#end' || !trimmed) {
      continue;
    }
    
    // Check if line starts a key:value pair
    const keyMatch = trimmed.match(/^(\S+?):\s*(.*)$/);
    if (keyMatch) {
      const [, key, valueStr] = keyMatch;
      
      // Finish collecting previous multiline value
      if (collectingTypes && typeLines.length > 0) {
        types = typeLines.join(',')
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0);
        typeLines = [];
        collectingTypes = false;
      } else if (collectingTypes && typeLines.length === 0 && typesKeySeen) {
        // types key seen but no values collected
        types = [];
        collectingTypes = false;
      }
      
      switch (key) {
        case 'types':
          typesKeySeen = true;
          if (valueStr) {
            typeLines.push(valueStr);
          }
          collectingTypes = true;
          break;
        case 'file-extension':
          fileExtension = valueStr.trim();
          collectingTypes = false;
          break;
        case 'state-dir':
          stateDir = valueStr.trim();
          collectingTypes = false;
          break;
        default:
          // Ignore unknown keys
          collectingTypes = false;
      }
    } else if (collectingTypes) {
      // Continuation line for types
      typeLines.push(trimmed);
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
  
  // Validate required fields
  if (!types) {
    return { ok: false, errors: [new Error('types field is required in config')] };
  }
  
  if (types.length === 0) {
    return { ok: false, errors: [new Error('types cannot be empty')] };
  }
  
  return {
    ok: true,
    value: {
      types,
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
  return {
    types: ['surface', 'fixture', 'instrument', 'behavior', 'feature'],
    fileExtension: '.bvf',
    stateDir: '.bvf-state'
  };
}
