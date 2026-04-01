# Refactoring log — 2026-04-01

## Goal
Improve internal code quality (readability, duplication, separation of concerns) **without changing external behavior** and while keeping **all 121 tests green**.

## What changed
### 1) `src/cli.ts`: extracted shared CLI plumbing + reduced duplication
`cli.ts` had substantial repeated logic across commands (`resolve`, `list`, `mark`, `deps`):

- config loading + consistent error printing
- `specs/` directory existence checks
- parsing all BVF spec files
- per-command differences in how parse errors are handled
- repeatedly re-implementing “absolute path → specs-relative path”
- repeated `sourceFile` propagation for nested behaviors

**Refactor:** introduced small, command-agnostic helpers at top of `cli.ts`:

- `loadProjectConfigOrExit(cwd)` and `exitWithConfigErrors(...)`
- `ensureSpecsDirOrExit(cwd)`
- `parseAllSpecs(specsDir, config, { collectParseErrors, propagateFiles })`
- `propagateSourceFile(entity, file)`
- `getRelativeSpecsPath(absolutePath)`

Then updated each command to call these helpers while preserving its existing semantics:

- `resolve`: still collects and prints parse errors, prints the same summary, exits 1
- `list` / `mark`: still ignore parse errors (matches prior behavior)
- `deps`: still exits with "Error resolving references" on resolution failure

#### Before / after (example)
**Before:** both `resolve` and `deps` had their own local `propagateSourceFile` implementations and duplicated parsing loops.

**After:** both call the same helpers:

```ts
const config = loadProjectConfigOrExit(cwd);
const specsDir = ensureSpecsDirOrExit(cwd);
const { entities } = parseAllSpecs(specsDir, config, {
  collectParseErrors: false,
  propagateFiles: true,
});
```

## Test status
- ✅ `npm test` (Vitest): **121 / 121 passing** after refactor.

## Risks / trade-offs
- This refactor intentionally stayed within `cli.ts` and did not change the resolver/parser behaviors.
- `cli.ts` still uses some `any` internally (as it previously did) to avoid risky structural type changes that could subtly affect behavior.

## Follow-ups (not done; future opportunities)
Low-risk next improvements that should still keep behavior stable:

1. **Introduce shared parsing/indexing utilities** in a dedicated module (e.g. `src/cli-helpers.ts`) to shrink `cli.ts` further.
2. **Strengthen typing** for “entities with nested behaviors” (currently `any`), likely by:
   - expanding `Behavior` type (or adding a `ParsedNode` union)
   - avoiding `as any` in `resolver.ts` behavior extraction.
3. **Consolidate entity-flattening** logic: `resolve` and `mark` both have ad-hoc flattening; a single shared function would reduce drift.
4. **Normalize parse error handling**: currently each command treats parse errors differently (by design today, but could be made explicit in spec/docs).
