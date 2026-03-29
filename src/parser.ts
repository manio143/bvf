import type { Entity, Param, Reference, Behavior, ParseResult } from './types.js';

/**
 * Parse a complete .bvf file containing multiple entity declarations
 */
export function parseBvfFile(content: string): ParseResult {
  const errors: Error[] = [];
  const entities: Entity[] = [];
  
  const lines = content.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i].trim();
    
    // Check for orphaned #behavior (not inside #decl feature)
    if (line.startsWith('#behavior')) {
      errors.push(new Error(`#behavior can only be used inside a feature (line ${i + 1})`));
      i++;
      continue;
    }
    
    // Skip empty lines and prose
    if (!line || !line.startsWith('#decl')) {
      i++;
      continue;
    }
    
    // Found a #decl - parse the entity
    const result = parseEntityFromLines(lines, i);
    
    if (!result.ok) {
      errors.push(...(result.errors || []));
      // Try to skip to next #decl or end
      i = findNext(lines, i + 1, '#decl');
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
 * Parse a single entity declaration starting at the given line index
 */
function parseEntityFromLines(lines: string[], startIndex: number): 
  { ok: boolean; value?: Entity; errors?: Error[]; nextLine: number } {
  
  const errors: Error[] = [];
  const declLine = lines[startIndex].trim();
  
  // Parse the declaration line
  const declMatch = declLine.match(/^#decl\s+(\w+)\s+([\w-]+)(?:\(([^)]*)\))?\s*(.*?)$/);
  if (!declMatch) {
    return {
      ok: false,
      errors: [new Error(`Invalid #decl syntax at line ${startIndex + 1}`)],
      nextLine: startIndex + 1
    };
  }
  
  const [, type, name, paramsStr, clausesStr] = declMatch;
  
  // Parse params
  const params: Param[] = [];
  if (paramsStr) {
    const paramTokens = paramsStr.split(',').map(p => p.trim());
    for (const token of paramTokens) {
      if (!token) continue;
      
      const paramMatch = token.match(/^(\w+)(?:\s*=\s*"([^"]*)")?$/);
      if (!paramMatch) {
        errors.push(new Error(`Invalid parameter syntax: ${token}`));
        continue;
      }
      
      const [, paramName, defaultValue] = paramMatch;
      params.push({
        name: paramName,
        required: !defaultValue,
        defaultValue
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
  
  // Find the #end
  let endIndex = -1;
  let bodyLines: string[] = [];
  let i = startIndex + 1;
  
  // Track nested blocks for features
  let inContext = false;
  let contextLines: string[] = [];
  const behaviors: Behavior[] = [];
  let currentBehavior: { name: string; params: Param[]; startLine: number; lines: string[] } | null = null;
  let inFor = false;
  let forVars: string[] = [];
  let forValues: any[][] = [];
  let forBehaviors: { name: string; params: Param[]; lines: string[] }[] = [];
  
  const isFeature = type === 'feature';
  
  while (i < lines.length) {
    const line = lines[i].trim();
    
    // Check for nested #decl (error)
    if (line.startsWith('#decl')) {
      errors.push(new Error(`#decl cannot be nested (line ${i + 1})`));
      return { ok: false, errors, nextLine: i };
    }
    
    if (line === '#end') {
      if (currentBehavior) {
        // Close current behavior
        if (inFor) {
          forBehaviors.push({
            name: currentBehavior.name,
            params: currentBehavior.params,
            lines: currentBehavior.lines
          });
        } else {
          behaviors.push(createBehavior(currentBehavior, contextLines));
        }
        currentBehavior = null;
        
        // If we were in a #for, check if there are more behaviors coming
        // If not (next line is not #behavior), then expand the #for
        const nextLineIdx = i + 1;
        if (inFor && nextLineIdx < lines.length) {
          const nextLine = lines[nextLineIdx].trim();
          if (!nextLine.startsWith('#behavior')) {
            // No more behaviors in this #for, expand it
            expandForBlock(forVars, forValues, forBehaviors, behaviors, contextLines);
            inFor = false;
            forVars = [];
            forValues = [];
            forBehaviors = [];
          }
        }
      } else if (inContext) {
        inContext = false;
      } else {
        // Main entity end
        // If we were still in a #for, expand it now
        if (inFor && forBehaviors.length > 0) {
          expandForBlock(forVars, forValues, forBehaviors, behaviors, contextLines);
          inFor = false;
        }
        endIndex = i;
        break;
      }
      i++;
      continue;
    }
    
    if (isFeature) {
      // Handle feature-specific blocks
      if (line === '#context') {
        if (contextLines.length > 0) {
          errors.push(new Error(`Only one #context block allowed per feature (line ${i + 1})`));
        }
        inContext = true;
        i++;
        continue;
      }
      
      const behaviorMatch = line.match(/^#behavior\s+(.+)$/);
      if (behaviorMatch) {
        if (!isFeature) {
          errors.push(new Error(`#behavior can only be used inside a feature (line ${i + 1})`));
          return { ok: false, errors, nextLine: i };
        }
        const behaviorDecl = behaviorMatch[1];
        
        if (inFor) {
          // Inside #for - keep raw name for later expansion
          currentBehavior = { name: behaviorDecl, params: [], startLine: i, lines: [] };
        } else {
          // Normal behavior - parse immediately
          const { name, params: behaviorParams } = parseBehaviorDecl(behaviorDecl);
          currentBehavior = { name, params: behaviorParams, startLine: i, lines: [] };
        }
        i++;
        continue;
      }
      
      const forMatch = line.match(/^#for\s+(.+?)\s+in\s+\[(.+)\]$/);
      if (forMatch) {
        const varsStr = forMatch[1];
        const valuesStr = forMatch[2];
        
        forVars = varsStr.split(',').map(v => v.trim());
        forValues = parseForValues(valuesStr, forVars.length);
        inFor = true;
        i++;
        continue;
      }
    }
    
    // Collect body lines
    if (inContext) {
      contextLines.push(lines[i]);
    } else if (currentBehavior) {
      currentBehavior.lines.push(lines[i]);
    } else {
      bodyLines.push(lines[i]);
    }
    
    i++;
  }
  
  if (endIndex === -1) {
    errors.push(new Error(`Unclosed #decl for ${name} (started at line ${startIndex + 1})`));
    return { ok: false, errors, nextLine: lines.length };
  }
  
  if (errors.length > 0) {
    return { ok: false, errors, nextLine: endIndex + 1 };
  }
  
  const body = bodyLines.join('\n').trim();
  
  // Extract references and param usages
  const allText = isFeature 
    ? body + '\n' + behaviors.map(b => b.body).join('\n')
    : body;
  const references = extractReferences(allText, clauses);
  const paramUsages = extractParamUsages(body);
  
  const entity: Entity = {
    type,
    name,
    params,
    clauses,
    body,
    references,
    paramUsages
  };
  
  if (isFeature) {
    entity.context = contextLines.length > 0 ? contextLines.join('\n').trim() : undefined;
    entity.behaviors = behaviors;
  }
  
  return { ok: true, value: entity, nextLine: endIndex + 1 };
}

function parseBehaviorDecl(decl: string): { name: string; params: Param[] } {
  const match = decl.match(/^(\S+?)(?:\(([^)]*)\))?$/);
  if (!match) {
    return { name: decl, params: [] };
  }
  
  const [, name, paramsStr] = match;
  const params: Param[] = [];
  
  if (paramsStr) {
    const paramTokens = paramsStr.split(',').map(p => p.trim());
    for (const token of paramTokens) {
      if (!token) continue;
      const paramMatch = token.match(/^(\w+)(?:\s*=\s*"([^"]*)")?$/);
      if (paramMatch) {
        const [, paramName, defaultValue] = paramMatch;
        params.push({
          name: paramName,
          required: !defaultValue,
          defaultValue
        });
      }
    }
  }
  
  return { name, params };
}

function createBehavior(
  current: { name: string; params: Param[]; lines: string[] },
  contextLines: string[]
): Behavior {
  const body = current.lines.join('\n').trim();
  const context = contextLines.length > 0 ? contextLines.join('\n').trim() : undefined;
  
  return {
    name: current.name,
    params: current.params,
    body,
    context
  };
}

function parseForValues(valuesStr: string, varCount: number): any[][] {
  const values: any[][] = [];
  
  if (varCount === 1) {
    // Single variable: ["val1", "val2", "val3"]
    const matches = valuesStr.matchAll(/"([^"]*)"/g);
    for (const match of matches) {
      values.push([match[1]]);
    }
  } else {
    // Multiple variables: [("a", "b"), ("c", "d")]
    const tupleMatches = valuesStr.matchAll(/\(([^)]+)\)/g);
    for (const match of tupleMatches) {
      const tupleStr = match[1];
      const parts = tupleStr.split(',').map(p => {
        const trimmed = p.trim();
        const quoted = trimmed.match(/^"([^"]*)"$/);
        return quoted ? quoted[1] : trimmed;
      });
      values.push(parts);
    }
  }
  
  return values;
}

function expandForBlock(
  forVars: string[],
  forValues: any[][],
  forBehaviors: { name: string; params: Param[]; lines: string[] }[],
  outputBehaviors: Behavior[],
  contextLines: string[]
): void {
  for (const valueSet of forValues) {
    for (const behaviorTemplate of forBehaviors) {
      let expandedName = behaviorTemplate.name;
      let expandedBody = behaviorTemplate.lines.join('\n');
      
      // Substitute {var} with values
      for (let i = 0; i < forVars.length; i++) {
        const varName = forVars[i];
        const value = valueSet[i];
        const quotedValue = `"${value}"`;
        
        expandedName = expandedName.replace(new RegExp(`\\{${varName}\\}`, 'g'), quotedValue);
        expandedBody = expandedBody.replace(new RegExp(`\\{${varName}\\}`, 'g'), value);
      }
      
      const context = contextLines.length > 0 ? contextLines.join('\n').trim() : undefined;
      
      outputBehaviors.push({
        name: expandedName,
        params: behaviorTemplate.params,
        body: expandedBody.trim(),
        context
      });
    }
  }
}

function parseReferenceArgs(argsStr: string): Record<string, string | { param: string }> {
  const args: Record<string, string | { param: string }> = {};
  
  const argMatches = argsStr.matchAll(/(\w+):\s*(?:"([^"]*)"|(\{(\w+)\}))/g);
  for (const match of argMatches) {
    const [, key, quotedValue, , paramName] = match;
    
    if (quotedValue !== undefined) {
      args[key] = quotedValue;
    } else if (paramName) {
      args[key] = { param: paramName };
    }
  }
  
  return args;
}

function extractReferences(text: string, clauses: Record<string, Reference>): Reference[] {
  const refs: Reference[] = [];
  const seen = new Set<string>();
  
  // Add clause references
  for (const ref of Object.values(clauses)) {
    const key = JSON.stringify(ref);
    if (!seen.has(key)) {
      refs.push(ref);
      seen.add(key);
    }
  }
  
  // Extract @{name} and @{name}(args)
  const refMatches = text.matchAll(/@\{([^}]+)\}(?:\(([^)]*)\))?/g);
  for (const match of refMatches) {
    const [, name, argsStr] = match;
    const ref: Reference = { name };
    
    if (argsStr) {
      ref.args = parseReferenceArgs(argsStr);
    }
    
    const key = JSON.stringify(ref);
    if (!seen.has(key)) {
      refs.push(ref);
      seen.add(key);
    }
  }
  
  return refs;
}

function extractParamUsages(text: string): string[] {
  const usages = new Set<string>();
  const matches = text.matchAll(/\{(\w+)\}/g);
  
  for (const match of matches) {
    usages.add(match[1]);
  }
  
  return Array.from(usages);
}

function findNext(lines: string[], start: number, token: string): number {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim().startsWith(token)) {
      return i;
    }
  }
  return lines.length;
}

/**
 * Parse a single entity declaration from a string (for testing)
 */
export function parseEntity(content: string): ParseResult {
  return parseBvfFile(content);
}
