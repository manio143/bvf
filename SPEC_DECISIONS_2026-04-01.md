# Spec vs Implementation Alignment Decisions

**Date:** 2026-04-01 11:00 UTC  
**Context:** Spec coverage audit revealed gaps between specs and implementation

## Decisions Made

### 1. ✅ Specs Updated (implementation will follow)

**cli-list.bvf:**
- Added `list-deep-flattens-all-levels` behavior
- Clarifies that flattening happens at ALL nesting levels, not just one
- Implementation needs to support deep recursive flattening

**cli-remove-orphans.bvf:**
- Added `remove-orphans-all-no-orphans` behavior
- Documents that `--all` with no orphans prints "No orphaned entries found."
- Implementation already does this, just wasn't spec'd

### 2. ❌ Implementation Bugs to Fix

**src/resolver.ts - Skip type validation when materializable set:**
- **Current:** `if (!config.materializable)` → skips validation when materializable exists
- **Spec:** `config-materializable-must-be-subset-of-types` → validation always required
- **Fix:** Remove the bypass, always validate types
- **Impact:** Config errors will now be caught (as intended)

**src/cli.ts - deps command regex fallback:**
- **Current:** Regex scans `context` for `@{...}` if no `references` field
- **Spec:** No spec for this fallback behavior
- **Root cause:** Parser bug (already fixed - parser now preserves references)
- **Fix:** Remove regex fallback code
- **Impact:** Cleaner code, behavior unchanged (references now always present)

**src/resolver.ts - Hard-coded `feature` type:**
- **Current:** Only extracts behaviors when `entity.type === 'feature'`
- **Spec:** Config defines taxonomy via `containment`, no built-in types
- **Fix:** Drive behavior extraction from `config.containment` instead of hard-coded string
- **Impact:** Works with custom taxonomies (not just 'feature')

### 3. 🔍 Parser DSL Features - Status Clarified

**KEEP and spec (active features):**
- Fenced code blocks (``` ... ```) - Inline examples in prose
- `#for <var> in [...]` expansion - Template mechanism
- Parameterized references `@{entity}(param="value")` - Template invocation
- Optional parameters `param?` - Already supported

**REMOVE from parser (deprecated):**
- `#context` blocks - Removed from docs (commit 2ad0daf), still in parser code
- `#behavior` shorthand - Never existed in parser, was doc error

**Action needed:**
1. Remove `#context` parsing code from src/parser.ts
2. Create `specs/language.bvf` documenting kept features
3. Add tests for language features

### 4. 🔍 Major Issues Requiring Spec Review (deferred)

**bvf resolve - Critical divergences:**
1. `--diff` mode wrong (headers/summary, includes current entities)
2. Orphan handling wrong (no warnings, no auto-delete)
3. Hash refresh broken (doesn't detect changes for pending)
4. Auto-transitions incomplete

**Parser DSL - Zero spec coverage:**
- Fenced code blocks, `#context`, `#for`, templates, params, errors
- Decision needed: Is this deprecated or should it be spec'd?

**User clarification needed:**
> "custom DSL was deprecated in favor of simpler syntax"

If deprecated:
- Remove DSL features from parser
- Update any specs/tests using those features

If keeping:
- Create `specs/language.bvf`
- Document all syntax rules
- Add error case behaviors

## Implementation Fix Priority

### High Priority (clear bugs)
1. ✅ Remove type validation bypass in resolver.ts
2. ✅ Remove regex fallback in cli.ts deps command
3. ✅ Drive behavior extraction from containment config
4. ✅ Remove `#context` parsing from parser.ts (deprecated)

### Medium Priority (needs spec)
5. ⏸️ Create `specs/language.bvf` for kept DSL features (fenced blocks, #for, params)

### Deferred (need design decisions)
4. ⏸️ Resolve command alignment (--diff, orphans, hash refresh, auto-transitions)
5. ⏸️ Parser DSL (deprecate vs spec)

## Next Steps

1. Fix 3 high-priority implementation bugs
2. Run tests → verify no regressions
3. Clarify parser DSL status with user
4. Address resolve command spec gaps based on correct design

## Files to Modify

**Immediate:**
- `src/resolver.ts` - Remove materializable bypass, use containment for extraction
- `src/cli.ts` - Remove deps regex fallback

**Deferred:**
- `specs/cli-resolve.bvf` - Complete coverage after design decisions
- `src/parser.ts` - Remove deprecated DSL features OR keep and spec them
- `specs/language.bvf` - Create if DSL is staying
