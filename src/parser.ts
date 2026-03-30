import type { Entity, Param, Reference, ParseResult, BvfConfig } from './types.js';

/**
 * Parse a complete .bvf file containing multiple entity declarations
 */
export function parseBvfFile(content: string, config?: BvfConfig): ParseResult {
  const errors: Error[] = [];
  const entities: Entity[] = [];
  
  // Remove code fences (triple-backtick blocks) before parsing
  const contentWithoutFences = removeFences(content);
  
  const lines = contentWithoutFences.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    
    // Skip empty lines and prose
    if (!line || !line.startsWith('#decl')) {
      i++;
      continue;
    }
    
    // Found a #decl - parse the entity
    const result = parseEntityFromLines(lines, i, null, config);
    
    if (!result.ok) {
      errors.push(...(result.errors || []));
      // Try to skip to next #decl or #end
      i = findNext(lines, i + 1, ['#decl', '#end']);
      continue;
    }
    
    entities.push(result.value!);
    i = result.nextLine;
  }
  
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  
  return { ok: true, value: entities };
}

/**
 * Remove triple-backtick fenced code blocks from content
 */
function removeFences(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFence = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      result.push(''); // Keep line count consistent
      continue;
    }
    
    if (inFence) {
      result.push(''); // Replace with blank line
    } else {
      result.push(line);
    }
  }
  
  return result.join('\n');
}

/**
 * Parse a single entity declaration starting at the given line index
 */
function parseEntityFromLines(
  lines: string[], 
  startIndex: number, 
  parentType: string | null,
  config?: BvfConfig
): 
  { ok: boolean; value?: Entity; errors?: Error[]; nextLine: number } {
  
  const errors: Error[] = [];
  const declLine = lines[startIndex].trim();
  
  // Parse the declaration line
  const declMatch = declLine.match(/^#decl\s+(\w+)\s+([\w-]+)(?:\(([^)]*)\))?\s*(.*?)$/);
  if (!declMatch) {
    return {
      ok: false,
      errors: [new Error(`invalid #decl syntax (line ${startIndex + 1})`)],
      nextLine: startIndex + 1
    };
  }
  
  const [, type, name, paramsStr, clausesStr] = declMatch;
  
  // Validate type against config
  if (config) {
    if (!config.types.includes(type)) {
      return {
        ok: false,
        errors: [new Error(`unknown type "${type}" (line ${startIndex + 1})`)],
        nextLine: startIndex + 1
      };
    }
    
    // Validate nesting if there's a parent
    if (parentType) {
      const allowed = config.containment?.get(parentType) || [];
      if (!allowed.includes(type)) {
        return {
          ok: false,
          errors: [new Error(`type "${type}" cannot be nested inside "${parentType}" (line ${startIndex + 1})`)],
          nextLine: startIndex + 1
        };
      }
    }
  }
  
  // Parse params
  const params: Param[] = [];
  if (paramsStr) {
    const paramTokens = paramsStr.split(',').map(p => p.trim());
    for (const token of paramTokens) {
      if (!token) continue;
      
      // Check for optional syntax: param?
      const isOptional = token.endsWith('?');
      const cleanToken = isOptional ? token.slice(0, -1) : token;
      
      const paramMatch = cleanToken.match(/^(\w+)(?:\s*=\s*"([^"]*)")?$/);
      if (!paramMatch) {
        errors.push(new Error(`invalid parameter syntax: ${token}`));
        continue;
      }
      
      const [, paramName, defaultValue] = paramMatch;
      
      params.push({
        name: paramName,
        required: !defaultValue && !isOptional,
        defaultValue: defaultValue || (isOptional ? undefined : undefined)
      });
    }
  }
  
  // Parse clauses (e.g., "on @{web-app}", "using @{login}(email: "x")")
  const clauses: Record<string, Reference> = {};
  if (clausesStr) {
    const clauseMatches = clausesStr.matchAll(/(\w+)\s+@\{([^}]+)\}(?:\(([^)]*)\))?/g);
    for (const match of clauseMatches) {
      const [, preposition, refName, argsStr] = match;
      const ref: Reference = { name: refName };
      
      if (argsStr) {
        ref.args = parseReferenceArgs(argsStr);
      }
      
      clauses[preposition] = ref;
    }
  }
  
  // Find the #end and parse body
  let endIndex = -1;
  let bodyLines: string[] = [];
  let contextLines: string[] = [];
  let inContext = false;
  let inFor = false;
  let forVars: string[] = [];
  let forValues: any[][] = [];
  const children: Entity[] = [];
  let forChildren: Entity[] = [];
  let i = startIndex + 1;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    
    // Check for #end
    if (line === '#end') {
      if (inContext) {
        // Closing context block
        inContext = false;
        i++;
        continue;
      } else if (inFor) {
        // Closing a #for block - expand it
        expandForBlock(forVars, forValues, forChildren, children);
        inFor = false;
        forVars = [];
        forValues = [];
        forChildren = [];
        i++;
        continue;
      } else {
        // Closing main entity
        endIndex = i;
        break;
      }
    }
    
    // Check for #context
    if (line === '#context') {
      if (contextLines.length > 0) {
        errors.push(new Error(`only one #context block allowed per container (line ${i + 1})`));
      }
      inContext = true;
      i++;
      continue;
    }
    
    // Check for #for
    const forMatch = line.match(/^#for\s+(.+?)\s+in\s+\[(.+)\]$/);
    if (forMatch) {
      const varsStr = forMatch[1];
      const valuesStr = forMatch[2];
      
      forVars = varsStr.split(',').map(v => v.trim());
      
      try {
        forValues = parseForValues(valuesStr, forVars.length);
      } catch (e: any) {
        errors.push(new Error(`invalid #for array syntax (line ${i + 1}): ${e.message}`));
      }
      
      inFor = true;
      i++;
      continue;
    }
    
    // Check for nested #decl
    if (line.startsWith('#decl')) {
      if (inFor) {
        // Parse child entity as part of #for expansion
        const childResult = parseEntityFromLines(lines, i, type, config);
        if (!childResult.ok) {
          errors.push(...(childResult.errors || []));
          i = childResult.nextLine;
          continue;
        }
        forChildren.push(childResult.value!);
        i = childResult.nextLine;
      } else {
        // Parse child entity normally
        const childResult = parseEntityFromLines(lines, i, type, config);
        if (!childResult.ok) {
          errors.push(...(childResult.errors || []));
          i = childResult.nextLine;
          continue;
        }
        children.push(childResult.value!);
        i = childResult.nextLine;
      }
      continue;
    }
    
    // Collect body lines
    if (inContext) {
      contextLines.push(lines[i]);
    } else {
      bodyLines.push(lines[i]);
    }
    
    i++;
  }
  
  if (endIndex === -1) {
    errors.push(new Error(`unclosed #decl for ${name} (started at line ${startIndex + 1})`));
    return { ok: false, errors, nextLine: lines.length };
  }
  
  if (errors.length > 0) {
    return { ok: false, errors, nextLine: endIndex + 1 };
  }
  
  const body = bodyLines.join('\n').trim();
  const context = contextLines.length > 0 ? contextLines.join('\n').trim() : undefined;
  
  // Extract references and param usages
  const allText = body + (context ? '\n' + context : '') + 
    children.map(c => c.body + (c.context || '')).join('\n');
  const references = extractReferences(allText, clauses);
  const paramUsages = extractParamUsages(body);
  
  const entity: Entity = {
    type,
    name,
    params,
    clauses,
    body,
    references,
    paramUsages,
    context,
    behaviors: children.length > 0 ? convertChildrenToBehaviors(children) : undefined
  };
  
  return { ok: true, value: entity, nextLine: endIndex + 1 };
}

/**
 * Convert child entities to behaviors format (for backward compatibility)
 */
function convertChildrenToBehaviors(children: Entity[]): any[] {
  return children.map(child => ({
    name: child.name,
    params: child.params,
    body: child.body,
    context: child.context
  }));
}

/**
 * Expand a #for block by substituting variables in each child entity
 */
function expandForBlock(
  vars: string[],
  valueSets: any[][],
  templates: Entity[],
  output: Entity[]
): void {
  for (const values of valueSets) {
    for (const template of templates) {
      const expanded = expandEntity(template, vars, values);
      output.push(expanded);
    }
  }
}

/**
 * Expand an entity template by substituting {var} placeholders
 */
function expandEntity(template: Entity, vars: string[], values: any[]): Entity {
  const substitutions = new Map<string, string>();
  for (let i = 0; i < vars.length; i++) {
    substitutions.set(vars[i], String(values[i]));
  }
  
  const expandText = (text: string) => {
    let result = text;
    for (const [key, value] of substitutions) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  };
  
  return {
    ...template,
    name: expandText(template.name),
    body: expandText(template.body),
    context: template.context ? expandText(template.context) : undefined
  };
}

/**
 * Parse #for values array - supports both single values and tuples
 */
function parseForValues(valuesStr: string, expectedVarCount: number): any[][] {
  // Try to parse as JSON array
  try {
    const parsed = JSON.parse(`[${valuesStr}]`);
    
    if (expectedVarCount === 1) {
      // Single variable - each element is a value
      return parsed.map((v: any) => [v]);
    } else {
      // Multiple variables - each element should be an array
      return parsed.map((v: any) => {
        if (!Array.isArray(v)) {
          throw new Error('expected array elements for multi-variable #for');
        }
        if (v.length !== expectedVarCount) {
          throw new Error(`expected ${expectedVarCount} values per tuple, got ${v.length}`);
        }
        return v;
      });
    }
  } catch (e: any) {
    throw new Error(`failed to parse #for array: ${e.message}`);
  }
}

/**
 * Parse reference arguments like: email: "test@x.com", pw: {password}
 */
function parseReferenceArgs(argsStr: string): Record<string, string | { param: string }> {
  const args: Record<string, string | { param: string }> = {};
  
  // Split by comma, but respect quotes
  const argTokens = splitArgs(argsStr);
  
  for (const token of argTokens) {
    const match = token.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    
    const [, key, valueStr] = match;
    
    // Check if it's a param reference {param}
    const paramMatch = valueStr.match(/^\{(\w+)\}$/);
    if (paramMatch) {
      args[key] = { param: paramMatch[1] };
    } else {
      // It's a string literal - remove quotes
      const cleaned = valueStr.replace(/^["']|["']$/g, '');
      args[key] = cleaned;
    }
  }
  
  return args;
}

/**
 * Split argument string by comma, respecting quotes
 */
function splitArgs(argsStr: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    
    if ((char === '"' || char === "'") && (i === 0 || argsStr[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
      }
      current += char;
    } else if (char === ',' && !inQuotes) {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    tokens.push(current.trim());
  }
  
  return tokens;
}

/**
 * Extract all references from text (including clauses)
 */
function extractReferences(text: string, clauses: Record<string, Reference>): Reference[] {
  const refs: Reference[] = [];
  
  // Add clause references
  for (const ref of Object.values(clauses)) {
    refs.push(ref);
  }
  
  // Find @{name} references in text
  const matches = text.matchAll(/@\{([^}]+)\}(?:\(([^)]*)\))?/g);
  for (const match of matches) {
    const [, refName, argsStr] = match;
    const ref: Reference = { name: refName };
    
    if (argsStr) {
      ref.args = parseReferenceArgs(argsStr);
    }
    
    // Only add if not already in refs
    if (!refs.some(r => r.name === refName)) {
      refs.push(ref);
    }
  }
  
  return refs;
}

/**
 * Extract parameter usages from text
 */
function extractParamUsages(text: string): string[] {
  const usages: string[] = [];
  const matches = text.matchAll(/\{(\w+)\}/g);
  
  for (const match of matches) {
    const paramName = match[1];
    if (!usages.includes(paramName)) {
      usages.push(paramName);
    }
  }
  
  return usages;
}

/**
 * Find the next line index containing one of the given prefixes
 */
function findNext(lines: string[], fromIndex: number, prefixes: string[]): number {
  for (let i = fromIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        return i;
      }
    }
  }
  return lines.length;
}
