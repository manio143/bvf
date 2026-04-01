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
    
    // Check for #for at top level - this is an error
    if (line.startsWith('#for')) {
      errors.push(new Error(`#for cannot be used outside a container entity (line ${i + 1})`));
      // Skip to next #decl or end of #for block
      i = findNext(lines, i + 1, ['#decl', '#end']);
      continue;
    }
    
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
  config?: BvfConfig,
  isTemplate?: boolean,
  templateVars?: Map<string, string> // Variables from outer #for scopes
): 
  { ok: boolean; value?: Entity; errors?: Error[]; nextLine: number } {
  
  const errors: Error[] = [];
  const declLine = lines[startIndex].trim();
  const currentTemplateVars = templateVars || new Map<string, string>();
  
  // Parse the declaration line
  let type: string, name: string, paramsStr: string | undefined, clausesStr: string;
  
  if (isTemplate) {
    // For templates inside #for, name can include {placeholders} with parentheses
    // Params must be preceded by whitespace to be recognized
    // Pattern: #decl type name({x}) (param1, param2) on @{...}
    const templateMatch = declLine.match(/^#decl\s+([\w-]+)\s+(.+?)(?:\s+\(([^)]*)\))?(?:\s+(on|using)\s+(.*))?$/);
    if (!templateMatch) {
      return {
        ok: false,
        errors: [new Error(`invalid #decl syntax in template (line ${startIndex + 1})`)],
        nextLine: startIndex + 1
      };
    }
    
    [, type, name, paramsStr, , clausesStr] = templateMatch;
    name = name.trim();
    clausesStr = clausesStr || '';
  } else {
    // For normal entities, use strict parsing
    const declMatch = declLine.match(/^#decl\s+([\w-]+)\s+([\w-]+)(?:\(([^)]*)\))?\s*(.*?)$/);
    if (!declMatch) {
      return {
        ok: false,
        errors: [new Error(`invalid #decl syntax (line ${startIndex + 1})`)],
        nextLine: startIndex + 1
      };
    }
    
    [, type, name, paramsStr, clausesStr] = declMatch;
  }
  
  // Validate type against config
  if (config) {
    // When materializable is specified, skip type validation
    // (allows flexible type usage for non-materializable entities)
    if (!config.materializable && !config.types.includes(type)) {
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
          errors: [new Error(`invalid nesting: type "${type}" cannot be nested inside "${parentType}" (line ${startIndex + 1})`)],
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
      
      // If we're in a template, allow {var} syntax for template variables
      if (isTemplate && token.match(/^\{(\w+)\}$/)) {
        // This is a template variable reference, skip param validation
        continue;
      }
      
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
  
  // Stack for nested #for contexts
  interface ForContext {
    vars: string[];
    values: any[][];
    children: Entity[];
  }
  const forStack: ForContext[] = [];
  
  const children: Entity[] = [];
  let i = startIndex + 1;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    const inFor = forStack.length > 0;
    
    // Check for #end
    if (line === '#end') {
      if (inFor) {
        // Closing a #for block - expand it
        const forCtx = forStack.pop()!;
        const targetChildren = forStack.length > 0 ? forStack[forStack.length - 1].children : children;
        
        // Build outer vars from remaining enclosing #for contexts
        const outerVars = new Map<string, string>();
        for (const ctx of forStack) {
          for (const v of ctx.vars) {
            outerVars.set(v, `{${v}}`); // Still a placeholder at this level
          }
        }
        
        expandForBlock(forCtx.vars, forCtx.values, forCtx.children, targetChildren, outerVars);
        i++;
        continue;
      } else {
        // Closing main entity
        endIndex = i;
        break;
      }
    }
    
    // Check for #for
    if (line.startsWith('#for')) {
      // #for is allowed inside container entities (which have children)
      // We're currently parsing an entity, so #for should be fine here
      // The validation should be about the syntax, not the location
      
      // Try to match proper #for syntax with "in" keyword
      const forMatch = line.match(/^#for\s+(.+?)\s+in\s+\[(.+)\]$/);
      if (!forMatch) {
        // Check if it's missing "in" keyword
        if (!line.includes(' in ')) {
          errors.push(new Error(`#for requires "in" keyword (line ${i + 1})`));
        } else if (!line.match(/\[.+\]/)) {
          errors.push(new Error(`#for requires array syntax [...] (line ${i + 1})`));
        } else {
          errors.push(new Error(`invalid #for syntax (line ${i + 1})`));
        }
        i++;
        continue;
      }
      
      const varsStr = forMatch[1];
      const valuesStr = forMatch[2];
      
      const newVars = varsStr.split(',').map(v => v.trim());
      
      let newValues: any[][] = [];
      try {
        newValues = parseForValues(valuesStr, newVars.length);
      } catch (e: any) {
        errors.push(new Error(`#for requires valid array syntax (line ${i + 1}): ${e.message}`));
      }
      
      // Push new #for context onto stack
      forStack.push({ vars: newVars, values: newValues, children: [] });
      i++;
      continue;
    }
    
    // Check for nested #decl
    if (line.startsWith('#decl')) {
      if (inFor) {
        // Parse child entity as part of #for expansion (mark as template)
        // Build combined template vars from all enclosing #for scopes
        const combinedVars = new Map(currentTemplateVars);
        for (const ctx of forStack) {
          for (const v of ctx.vars) {
            combinedVars.set(v, `{${v}}`); // Placeholder - will be substituted during expansion
          }
        }
        
        const childResult = parseEntityFromLines(lines, i, type, config, true, combinedVars);
        if (!childResult.ok) {
          errors.push(...(childResult.errors || []));
          i = childResult.nextLine;
          continue;
        }
        forStack[forStack.length - 1].children.push(childResult.value!);
        i = childResult.nextLine;
      } else {
        // Parse child entity normally
        const childResult = parseEntityFromLines(lines, i, type, config, false, currentTemplateVars);
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
    bodyLines.push(lines[i]);
    
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
  
  // Extract references and param usages
  const allText = body + 
    children.map(c => c.body + (c.context || '')).join('\n');
  const references = extractReferences(allText, clauses);
  const paramUsages = extractParamUsages(body);
  
  // If this is a template inside a #for, validate that all {placeholders} correspond to:
  // 1. Entity parameters, OR
  // 2. Template variables from enclosing #for contexts
  if (isTemplate && currentTemplateVars.size > 0) {
    const validVars = new Set<string>();
    
    // Add entity parameters
    for (const param of params) {
      validVars.add(param.name);
    }
    
    // Add template variables
    for (const varName of currentTemplateVars.keys()) {
      validVars.add(varName);
    }
    
    // Check each param usage
    for (const usedVar of paramUsages) {
      if (!validVars.has(usedVar)) {
        errors.push(new Error(
          `undefined variable {${usedVar}} (available: ${Array.from(validVars).join(', ')})`
        ));
      }
    }
    
    if (errors.length > 0) {
      return { ok: false, errors, nextLine: endIndex + 1 };
    }
  }
  
  const entity: Entity = {
    type,
    name,
    params,
    clauses,
    body,
    references,
    paramUsages,
    context: undefined, // Context field reserved for future use, not from #context blocks
    behaviors: children.length > 0 ? convertChildrenToBehaviors(children) : undefined,
    line: startIndex + 1
  };
  
  return { ok: true, value: entity, nextLine: endIndex + 1 };
}

/**
 * Convert child entities to behaviors format (preserving recursive structure)
 */
function convertChildrenToBehaviors(children: Entity[]): any[] {
  return children.map(child => ({
    name: child.name,
    type: child.type,
    params: child.params,
    body: child.body,
    context: child.context,
    line: child.line,
    // Preserve references and clauses for dependency tracking
    clauses: child.clauses,
    references: child.references,
    paramUsages: child.paramUsages,
    behaviors: child.behaviors // Preserve nested children for multi-level containment
  }));
}

/**
 * Expand a #for block by substituting variables in each child entity
 */
function expandForBlock(
  vars: string[],
  valueSets: any[][],
  templates: Entity[],
  output: Entity[],
  outerVars?: Map<string, string>
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
  const bodySubstitutions = new Map<string, string>();
  
  // For single-variable loops, quote string values in body but not in names
  // For multi-variable loops (tuples), use values as-is everywhere
  const shouldQuoteInBody = vars.length === 1;
  
  for (let i = 0; i < vars.length; i++) {
    const rawValue = String(values[i]);
    
    // Always use unquoted value for names
    substitutions.set(vars[i], rawValue);
    
    // For body, quote strings in single-var loops only
    const bodyValue = (shouldQuoteInBody && typeof values[i] === 'string') 
      ? `"${values[i]}"` 
      : rawValue;
    bodySubstitutions.set(vars[i], bodyValue);
  }
  
  const expandText = (text: string, useBodySubs: boolean) => {
    let result = text;
    const subs = useBodySubs ? bodySubstitutions : substitutions;
    for (const [key, value] of subs) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  };
  
  const expandedName = expandText(template.name, false);
  const expandedBody = expandText(template.body, true);
  const expandedContext = template.context ? expandText(template.context, true) : undefined;
  
  return {
    ...template,
    name: expandedName,
    body: expandedBody,
    context: expandedContext
  };
}

/**
 * Parse #for values array - supports both single values and tuples
 */
function parseForValues(valuesStr: string, expectedVarCount: number): any[][] {
  // First, quote unquoted identifiers to make valid JSON
  // Match: bare identifiers (not already in quotes, not numbers)
  let jsonReady = valuesStr;
  
  // Quote bare identifiers: auth → "auth"
  // But preserve already-quoted strings and numbers
  // Use negative lookbehind/lookahead to avoid quoting things already in quotes
  jsonReady = jsonReady.replace(/(?<!")(\b[a-zA-Z_][\w-]*\b)(?!")/g, (match, ident, offset, str) => {
    // Check if this identifier is inside quotes by looking for unbalanced quotes before it
    const before = str.substring(0, offset);
    const quotesBefore = (before.match(/"/g) || []).length;
    
    // If odd number of quotes before, we're inside a quoted string, don't modify
    if (quotesBefore % 2 === 1) {
      return match;
    }
    
    return `"${ident}"`;
  });
  
  // Convert Python-style tuples (parentheses) to JSON arrays (square brackets)
  jsonReady = jsonReady.replace(/\(/g, '[').replace(/\)/g, ']');
  
  // Try to parse as JSON array
  try {
    const parsed = JSON.parse(`[${jsonReady}]`);
    
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
 * Parse reference arguments like: 
 *   endpoint="/health"  (string literal with =)
 *   email: {param}      (param reference with :)
 */
function parseReferenceArgs(argsStr: string): Record<string, string | { param: string }> {
  const args: Record<string, string | { param: string }> = {};
  
  // Split by comma, but respect quotes
  const argTokens = splitArgs(argsStr);
  
  for (const token of argTokens) {
    // Try colon syntax first (for param references): key: {param}
    let match = token.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
    
    if (match) {
      const [, key, valueStr] = match;
      
      // Check if it's a param reference {param}
      const paramMatch = valueStr.match(/^\{(\w+)\}$/);
      if (paramMatch) {
        args[key] = { param: paramMatch[1] };
      } else {
        // Colon with non-param value - remove quotes if present
        const cleaned = valueStr.replace(/^["']|["']$/g, '');
        args[key] = cleaned;
      }
      continue;
    }
    
    // Try equals syntax (for string literals): key="value"
    match = token.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
    
    if (match) {
      const [, key, valueStr] = match;
      
      // Remove quotes from value
      const cleaned = valueStr.replace(/^["']|["']$/g, '');
      args[key] = cleaned;
      continue;
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
