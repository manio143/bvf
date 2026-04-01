# Language.bvf Materialization Report

**Date:** 2026-04-01  
**Agent:** Subagent (materialize-language)  
**Source Spec:** specs/language.bvf  
**Target Test:** tests/language.test.ts  

## Summary

Successfully materialized all 50 behaviors from `specs/language.bvf` into executable test code.

### Test Results (Initial Run)

- **Total tests:** 50
- **Passing:** 36 (72%)
- **Failing:** 14 (28%)

**This is CORRECT and EXPECTED** - tests were written from specs BEFORE implementation, following TDD red-green-refactor methodology.

## Test Structure

Created single test file: `tests/language.test.ts`

Organized into 11 sections matching the spec:
1. Fenced Code Blocks (3 tests)
2. #for Expansion (12 tests)
3. Parameterized References (5 tests)
4. Optional Parameters (4 tests)
5. Basic Entity Declaration (10 tests)
6. Clauses (4 tests)
7. References Extraction (3 tests)
8. Parameter Usages (2 tests)
9. Template Syntax (2 tests)
10. Error Recovery (3 tests)
11. Prose and Comments (2 tests)

## Implementation Details

### Helper Functions

Implemented `@{run-parse}` instrument as specified in surfaces.bvf:

```typescript
function runParse(content: string, config?: BvfConfig) {
  return parseBvfFile(content, config);
}
```

### Test Fixtures

Created `defaultConfig` fixture matching surfaces.bvf specification:

```typescript
const defaultConfig: BvfConfig = {
  types: ['feature', 'behavior', 'endpoint', 'surface', 'fixture', 'instrument'],
  containment: new Map([
    ['feature', ['behavior', 'endpoint']]
  ]),
  fileExtension: '.bvf',
  stateDir: '.bvf-state'
};
```

### Test Naming Convention

Each test name matches its corresponding behavior name in the spec:
- `fenced-code-ignored` → it('fenced-code-ignored', ...)
- `for-expansion-basic` → it('for-expansion-basic', ...)
- etc.

## Failing Tests (Features Not Yet Implemented)

The following 14 tests are failing because parser features are not implemented:

### #for Loop Features (8 failures)
1. `for-expansion-basic` - Basic #for loop expansion
2. `for-expansion-with-quoted-strings` - Single-variable quoting
3. `for-expansion-multi-variable` - Multi-variable tuples
4. `for-closes-with-end` - #for closing syntax
5. `for-tuple-count-mismatch` - Tuple validation (wrong error message)
6. `for-nested-loops-supported` - Nested #for loops
7. `for-nested-variable-scoping` - Variable scoping across levels
8. `for-validates-template-variables` - Template variable validation (currently no validation)

### Parameterized References (4 failures)
9. `reference-with-single-param` - Single parameter in reference
10. `reference-with-multiple-params` - Multiple parameters in reference
11. `inline-reference-with-params` - Inline reference parameters
12. `clause-with-params` - Clause parameters

### Template Syntax (2 failures)
13. `template-name-with-placeholders` - {var} in entity names
14. `template-body-substitution` - {var} in entity bodies

## Passing Tests (Already Implemented)

36 tests are passing, covering:

✅ **Fenced code blocks** (all 3 tests)
- Fences are completely ignored
- Line numbers preserved
- Multiple fences handled

✅ **#for validation** (4/12 tests)
- Requires "in" keyword
- Requires array syntax
- Cannot be used outside container
- Some multi-variable syntax (partial)

✅ **Parameter parsing** (all 9 tests)
- Optional parameters (?)
- Required parameters
- Default values ("value")
- Mixed parameters
- Entity parameters in clause references

✅ **Basic declarations** (all 10 tests)
- Type and name parsing
- Hyphenated names
- #end closing
- Unclosed detection
- Type validation
- Nesting rules

✅ **Clauses** (3/4 tests)
- on @{ref} syntax
- using @{ref} syntax
- Multiple clauses
- (Parameters not yet supported)

✅ **References** (all 3 tests)
- Body extraction
- Clause inclusion
- Deduplication

✅ **Parameter usages** (all 2 tests)
- {param} extraction
- Deduplication

✅ **Error recovery** (all 3 tests)
- Invalid decl syntax
- Invalid param syntax
- Skips to next decl

✅ **Prose handling** (all 2 tests)
- Prose lines ignored
- Empty lines ignored

## Ambiguities Found in Specs

### 1. #for Tuple Count Mismatch Error Message

**Spec says:**
```
Then ok = false
And errors[0] contains "expected 2 values per tuple"
```

**Parser currently returns:**
```
"#for requires valid array syntax"
```

**Resolution needed:** Should parser validate tuple count and provide specific error, or is generic error acceptable?

### 2. Template Variable Validation Timing

**Spec behavior:** `for-validates-template-variables`

**Expected:** Parser should detect undefined variables during #for expansion and report them.

**Current:** No validation (test shows ok=true when it expects ok=false)

**Question:** Should validation happen during parsing, or during materialization/execution?

### 3. Single-Variable vs Multi-Variable Quoting Rules

**Specs indicate:**
- Single-variable #for: values are quoted in body (`"python"`)
- Multi-variable #for: values are not quoted in body (`auth`, `1`)

**Current behavior:** Appears to follow this pattern in passing tests

**Clarification needed:** Is this intentional design or implementation artifact? Why the difference?

## Next Steps

These tests define "done" for the language syntax implementation. The parser should be enhanced to:

1. **Implement #for expansion** (highest priority - 8 failing tests)
   - Basic single/multi-variable expansion
   - Nested loops
   - Variable scoping
   - Template validation

2. **Implement parameterized references** (4 failing tests)
   - Parse (key="value") syntax
   - Handle multiple parameters
   - Support param references {param}

3. **Resolve ambiguities** (3 spec clarifications needed)
   - Decide on tuple validation error messages
   - Decide when to validate template variables
   - Document quoting rules in spec prose

## Files

- **Test file:** `/home/node/.openclaw/workspace/projects/bvf/tests/language.test.ts`
- **Spec file:** `/home/node/.openclaw/workspace/projects/bvf/specs/language.bvf`
- **Surfaces:** `/home/node/.openclaw/workspace/projects/bvf/specs/surfaces.bvf`

## Verification

To run these tests:

```bash
cd /home/node/.openclaw/workspace/projects/bvf
npm test -- tests/language.test.ts
```

Expected: 36 passing, 14 failing (until parser features are implemented)
