# BVF Test Suite - TDD Red Phase

## Summary

Created comprehensive vitest test files covering all behaviors described in the BVF specs. All tests are written in the **TDD red phase** - they will fail until implementation is written.

## Test Files Created

### 1. `tests/parser.test.ts` (11.9 KB)
Tests for parsing `.bvf` file content into structured entities.

**Coverage:**
- ✅ `entity-parsing` feature (7 tests)
  - Simple entity declarations
  - Entities with parameters (required/optional)
  - Entities with clauses (on, using, etc.)
  - Multiple entities in one file
  - Prose text between entities (should be ignored)
  - Error: unclosed `#decl` blocks
  - Error: nested `#decl` blocks

- ✅ `feature-parsing` feature (6 tests)
  - Features with `#context` and `#behavior` blocks
  - Features without context
  - `#for` loop expansion (single values)
  - `#for` loop with tuples
  - Error: multiple `#context` blocks
  - Error: `#behavior` outside feature

- ✅ `reference-extraction` feature (5 tests)
  - Bare references `@{name}`
  - Parameterized references `@{name}(key: "value")`
  - Parameter passthrough `{param}` in reference args
  - Own parameter usage `{param}` in body
  - Warning: undeclared parameter usage

**Imports expected:** `parseBvfFile()` from `../src/parser.js`

---

### 2. `tests/resolver.test.ts` (12.4 KB)
Tests for reference validation and dependency graph construction.

**Coverage:**
- ✅ `reference-validation` feature (7 tests)
  - Valid references resolve successfully
  - Error: unresolved reference
  - Error: missing required parameter
  - Optional parameter omission (should succeed)
  - Error: unknown parameter name (with suggestions)
  - Error: bare reference to entity requiring params
  - Bare reference to paramless entity (should succeed)

- ✅ `dependency-graph` feature (5 tests)
  - Direct dependencies from references
  - Transitive dependency computation
  - Circular dependency detection
  - Clause references included in graph
  - Feature context references inherited by behaviors

- ✅ `type-taxonomy` feature (2 tests)
  - Configured types accepted
  - Error: unconfigured entity type

**Imports expected:** `resolveReferences()`, `buildDependencyGraph()` from `../src/resolver.js`

---

### 3. `tests/manifest.test.ts` (11.1 KB)
Tests for materialization state tracking and staleness detection.

**Coverage:**
- ✅ `materialization-state` feature (7 tests)
  - New entity has status "pending"
  - Unchanged entity stays "current"
  - Content change makes entity "stale"
  - Dependency change makes entity "stale"
  - Transitive dependency changes propagate
  - Recording materialization updates manifest
  - Removed entity detected as "orphaned"

- ✅ `hash-computation` feature (3 tests)
  - Spec hash from content (deterministic)
  - Dependency hash includes transitive deps
  - Dependency hash changes when deps change

**Imports expected:** 
- `loadManifest()`, `saveManifest()`
- `computeSpecHash()`, `computeDependencyHash()`
- `getEntityStatus()`, `recordMaterialization()`
from `../src/manifest.js`

---

### 4. `tests/config.test.ts` (5.3 KB)
Tests for parsing `bvf.config` files.

**Coverage:**
- ✅ Config parsing (13 tests)
  - Valid config with all fields
  - Custom types
  - Multiline types list
  - Default config
  - Error: config without types
  - Error: malformed config
  - Error: unclosed `#config`
  - Custom file extension
  - Custom state directory
  - Unknown keys ignored
  - Whitespace trimmed from types
  - Error: duplicate `#config` blocks
  - Error: empty types list

**Imports expected:** `parseConfig()`, `defaultConfig()` from `../src/config.js`

---

### 5. `tests/cli.test.ts` (10.3 KB)
Integration tests for CLI commands.

**Coverage:**
- ✅ `cli-resolve` feature (4 tests)
  - Clean project (all current)
  - Project with stale entities
  - Project with errors (exit code 1)
  - Resolve with `--diff` flag

- ✅ `cli-list` feature (4 tests)
  - List all entities
  - List by type filter
  - List by feature filter
  - Empty result set

- ✅ `cli-init` feature (2 tests)
  - Init creates config, directories
  - Init refuses existing project

**Setup:** Uses temp directories, runs CLI via `node dist/cli.js`

---

## Test Patterns Used

### Result Pattern
All functions return `{ ok: boolean, value?: T, errors?: Error[] }`

```typescript
const result = parseBvfFile(content);
expect(result.ok).toBe(true);
expect(result.value).toHaveLength(1);
```

### Type Definitions
Each test file includes inline type definitions for expected structures:
- `Entity`, `Param`, `Reference`, `Behavior`
- `ResolvedEntity`, `DependencyGraph`
- `Manifest`, `ManifestEntry`, `EntityStatus`
- `BvfConfig`

### Import Extensions
All imports use `.js` extensions for Node16 module resolution:
```typescript
import { parseBvfFile } from '../src/parser.js';
```

---

## Running Tests

```bash
cd /home/node/.openclaw/workspace/projects/bvf

# Run all tests (will fail - no implementation yet)
npx vitest run

# Run specific test file
npx vitest run tests/parser.test.ts

# Watch mode
npx vitest
```

---

## Next Steps (Implementation)

1. Create `src/types.ts` with shared type definitions
2. Implement `src/parser.ts` (entity & config parsing)
3. Implement `src/resolver.ts` (reference validation & dependency graph)
4. Implement `src/manifest.ts` (state tracking & hashing)
5. Implement `src/config.ts` (config file parsing)
6. Implement `src/cli.ts` (CLI commands)
7. Implement `src/index.ts` (public API exports)

All tests are currently in **TDD red phase** - they define expected behavior but will fail until implementation is written.

---

## Statistics

- **Total test files:** 5
- **Total test cases:** 58
- **Total lines:** ~2,400
- **Coverage:** All behaviors from specs + edge cases
