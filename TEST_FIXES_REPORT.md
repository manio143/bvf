# BVF Test Alignment Fixes - Report

**Date:** 2026-03-30
**Task:** Fix 4 specific test alignment issues identified by reviewer

## Summary

- **3 out of 4 tests FIXED and PASSING** ✅
- **1 test written per spec but reveals implementation gap** ⚠️

## Issue 1: `resolve-clean-project` ✅ FIXED

**Location:** `tests/cli-resolve.test.ts`

**Problem:** Test checked for ✓ symbol generically but didn't verify EACH entity has it individually.

**Spec requirement:** "Then all entities show ✓ status."

**Fix applied:**
- Added loop to verify each entity (app, data, test) appears on a line containing ✓
- Now asserts that every entity name appears with ✓ status individually

**Status:** ✅ PASSING

## Issue 2: `resolve-mixed-statuses-ordered` ✅ FIXED

**Location:** `tests/cli-resolve.test.ts`

**Problem:** Only tested 2 features. Didn't verify alphabetical ordering within groups.

**Spec requirement:** "Features with all-current behaviors appear first (alphabetically). Features with any stale or pending behaviors are pushed to the end (also alphabetically)."

**Fix applied:**
- Created 4 features (2 all-current, 2 with-problems) to verify grouping
- Named features alpha/bravo (clean) and charlie/delta (problems) for alphabetical test
- Verified alphabetical ordering within each group (clean first, then problems)
- Used `resolveReferences()` and proper hash computation for behaviors inside features

**Status:** ✅ PASSING

## Issue 3: `resolve-with-diff` ⚠️ IMPLEMENTATION GAP

**Location:** `tests/cli-resolve.test.ts`

**Problem:** Didn't test cascade (1 change → multiple stale). Format check was loose.

**Spec requirement:** 
- Machine-parseable format: `<status> <type> <name> <relative-path>:<line>`
- "The human-readable tree output is suppressed — `--diff` is designed for piping into scripts"
- Shows root causes AND affected entities (cascade)

**Fix applied:**
- Created surface with 2+ dependent behaviors to test cascade
- Surface changed → instrument stale → both behaviors stale
- Added strict format validation: `^(stale|pending|orphaned)\s+(surface|instrument|behavior|fixture|feature)\s+\S+\s+\S+:\d+$`
- Verified all 4 entities appear (app, login, first-test, second-test)

**Status:** ⚠️ TEST WRITTEN PER SPEC, BUT FAILING

**Reason for failure:** The current implementation does NOT output machine-parseable format when `--diff` is used. Instead, it outputs the normal human-readable tree format. This is an **implementation gap** — the spec describes behavior that doesn't exist yet.

**Recommendation:** Implementation needs to be updated to:
1. Detect `--diff` flag
2. Switch to machine-parseable output format
3. Output one line per non-current entity: `<status> <type> <name> <path>:<line>`
4. Suppress the human-readable tree output

## Issue 4: `list-all-entities` ✅ FIXED

**Location:** `tests/cli-list.test.ts`

**Problem:** Didn't verify type and file location appear in output.

**Spec requirement:** "all 5 entities are listed with their type, name, and source file location"

**Fix applied:**
- Verified each entity name appears in output
- Verified each entity's source file appears in output
- Verified type headers appear (surface:, fixture:, instrument:, behavior:)
- The CLI groups by type (type as header), so adjusted test to match actual output format

**Status:** ✅ PASSING

## Test Suite Status

**Overall:** 47 passed, 5 failed, 3 skipped (55 total)

**My 4 assigned tests:**
- 3 PASSING ✅
- 1 FAILING (implementation gap, test is correct per spec) ⚠️

**Other failing tests (not my responsibility):**
- `resolve-catches-malformed-config-no-colon`
- `resolve-catches-malformed-config-no-value`
- `resolve-ignores-decl-inside-fences`
- `resolve-accepts-optional-param-syntax`

## Files Modified

1. `tests/cli-resolve.test.ts`
   - Fixed `resolve-clean-project` test (line ~1020)
   - Fixed `resolve-mixed-statuses-ordered` test (line ~1100)
   - Fixed `resolve-with-diff` test (line ~1205)

2. `tests/cli-list.test.ts`
   - Fixed `list-all-entities` test (line ~40)

## Notes

- All fixes were made by reading the spec behaviors FIRST, then writing tests to match
- Did NOT read implementation code (src/*.ts) as instructed
- Used proper hash computation and reference resolution where needed
- Tests are written to verify spec requirements, not implementation quirks
- One test (`resolve-with-diff`) correctly identifies missing functionality
