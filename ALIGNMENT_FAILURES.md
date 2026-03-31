# Alignment Review Failures - Rematerialization Queue

**Date:** 2026-03-31 11:29 UTC  
**Review round:** 1  
**Status:** 11 tests need fixing

---

## Failed Tests (Need Rematerialization)

All failures share the same root cause: **fake dependency hash computation**.

### 1. mark-test-reviewed
**Issue:** Uses `computeHash('my-surface')` instead of hashing actual surface entity content.  
**Fix:** Extract full `#decl surface my-surface ... #end` block and hash that.

### 2. mark-test-needs-fixing
**Issue:** Same - fake dependency hash using entity name.  
**Fix:** Same as above.

### 3. workflow-soundness-review-pass
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 4. workflow-soundness-review-fail
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 5. workflow-elaboration-triggers-re-review
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 6. workflow-materialization
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 7. workflow-alignment-review-pass
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 8. workflow-alignment-review-fail
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 9. workflow-staleness-auto-restart
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 10. workflow-dependency-change-cascade
**Issue:** Multiple fake hashes - using partial content fragments.  
**Fix:** Extract full entity declarations including `#decl ... #end` wrappers.

### 11. resolve-writes-manifest-on-auto-transition
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

### 12. resolve-preserves-artifact-on-staleness
**Issue:** Fake dependency hash.  
**Fix:** Hash actual surface declaration content.

---

## Root Cause Analysis

SKILL.md Part 2 explicitly warns against this:
> "The spec says 'given all entities are current.' You write a test that hardcodes fake hash values instead of computing real ones. The test *looks* like it establishes the precondition, but doesn't actually create the state the spec describes."

**What went wrong:**
Tests compute hashes from entity names or prose snippets instead of full entity declarations. When the real system computes `dependencyHash`, it extracts the complete `#decl ... #end` block for each dependency and hashes that.

**Solution:**
Implement a helper function that:
1. Parses spec files to extract entity declarations
2. Returns the full declaration text (including `#decl`/`#end`)
3. Hashes that content for precondition setup

Example:
```typescript
function extractEntityDeclaration(specContent: string, entityName: string): string {
  // Parse spec, find entity, return full "#decl ... #end" block
}

const surfaceDecl = extractEntityDeclaration(specContent, 'my-surface');
const depHash = computeHash(surfaceDecl);
```

---

## Rematerialization Task

Fix all 11 tests by:
1. Adding `extractEntityDeclaration()` helper
2. Replacing all `computeHash('my-surface')` with `computeHash(extractEntityDeclaration(...))`
3. Ensuring dependency hashes match what the real CLI implementation would compute

**Constraint:** Do NOT modify specs. The specs are correct. Only fix the test implementations.
