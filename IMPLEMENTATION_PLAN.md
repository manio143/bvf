# BVF Workflow Implementation Plan

**Date:** 2026-03-31 11:20 UTC  
**Status:** Soundness review complete, ready for implementation

---

## Implementation Tasks

### Task 1: Update `mark` Command (cli.ts)

**Current:**
- `mark <entity> needs-elaboration [--note]`
- `mark <entity> review-failed [--note]`
- `mark <entity> current --artifact <path>`

**New:**
- `mark <entity> spec-needs-elaboration [--note]`
- `mark <entity> spec-reviewed`
- `mark <entity> test-ready --artifact <path>`
- `mark <entity> test-reviewed`
- `mark <entity> test-needs-fixing [--note]`

**Changes:**
```typescript
// Old status values
const validStatuses = ['needs-elaboration', 'review-failed', 'current'];

// New status values
const validStatuses = [
  'spec-needs-elaboration',
  'spec-reviewed',
  'test-ready',
  'test-reviewed',
  'test-needs-fixing'
];

// Map status arg → (status, reason) pairs
switch (statusArg) {
  case 'spec-needs-elaboration':
    entry.status = 'pending';
    entry.reason = 'needs-elaboration';
    break;
  
  case 'spec-reviewed':
    entry.status = 'pending';
    entry.reason = 'reviewed';
    entry.specHash = computeSpecHash(entity);
    entry.dependencyHash = computeDependencyHash(entity, currentHashes);
    break;
  
  case 'test-ready':
    if (!artifact) {
      console.error('Error: --artifact required for test-ready');
      process.exit(1);
    }
    entry.status = 'current';
    entry.reason = 'needs-review';
    entry.specHash = computeSpecHash(entity);
    entry.dependencyHash = computeDependencyHash(entity, currentHashes);
    entry.artifact = artifact;
    entry.materializedAt = new Date().toISOString();
    break;
  
  case 'test-reviewed':
    entry.status = 'current';
    entry.reason = 'reviewed';
    break;
  
  case 'test-needs-fixing':
    entry.status = 'pending';
    entry.reason = 'reviewed';
    // Preserve artifact!
    break;
}
```

**Additional:** Add staleness detection (`mark-detects-stale-before-blessing`)
```typescript
// Before blessing with spec-reviewed, check if hashes match
if (statusArg === 'spec-reviewed' && entry) {
  const currentSpecHash = computeSpecHash(entity);
  if (entry.specHash !== currentSpecHash) {
    const forceIndex = cmdArgs.indexOf('--force');
    if (forceIndex === -1) {
      console.error(`Warning: entity has changed since last state (${entry.reason || 'unknown'}).`);
      console.error(`Run 'bvf resolve' to validate changes before marking as reviewed.`);
      process.exit(1);
    }
  }
}
```

---

### Task 2: Update `resolve` Command (cli.ts)

**Add manifest write-back for auto-transitions:**

```typescript
async function cmdResolve(cmdArgs: string[]) {
  // ... existing code ...
  
  // After computing all statuses, check for auto-transitions
  let manifestChanged = false;
  
  for (const entity of allResolvedEntities) {
    const entry = manifest.entries.get(entity.name);
    if (!entry || !entry.status) continue;
    
    const currentSpecHash = computeSpecHash(entity);
    const currentDepHash = computeDependencyHash(entity, currentHashes);
    
    // Auto-transition 1: Elaboration complete → needs-review
    if (entry.reason === 'needs-elaboration' && entry.specHash !== currentSpecHash) {
      entry.specHash = currentSpecHash;
      entry.dependencyHash = currentDepHash;
      entry.reason = 'needs-review';
      manifestChanged = true;
    }
    
    // Auto-transition 2: Staleness detected → needs-review
    if (entry.status && (entry.specHash !== currentSpecHash || entry.dependencyHash !== currentDepHash)) {
      entry.status = 'pending';
      entry.reason = 'needs-review';
      entry.specHash = currentSpecHash;
      entry.dependencyHash = currentDepHash;
      // Keep artifact for context
      manifestChanged = true;
    }
  }
  
  // Auto-transition 3: Orphaned entities → remove
  const orphaned = findOrphanedEntries(manifest, allResolvedEntities);
  if (orphaned.length > 0) {
    for (const entry of orphaned) {
      manifest.entries.delete(entry.name);
    }
    manifestChanged = true;
  }
  
  // Write manifest if changed
  if (manifestChanged) {
    saveManifest(stateDir, manifest);
  }
  
  // ... rest of output logic ...
}
```

---

### Task 3: Update Display Logic

**Show reason in resolve output:**

```typescript
function printEntity(entity, status, manifest, showDiff, indent, countedTypes) {
  // ... existing symbol logic ...
  
  const entry = manifest.entries.get(entity.name);
  const reasonText = entry?.reason ? ` [${entry.reason}]` : '';
  
  console.log(`${symbolWithColor} ${entity.name} (${entity.type})${reasonText}`);
  
  // Show note if present
  if (entry?.note) {
    console.log(`${' '.repeat(indent + 2)}Note: ${entry.note}`);
  }
}
```

---

### Task 4: Test Updates

**Files to update:**
- All existing tests that use old command names
- `tests/cli.test.ts` (or equivalent e2e tests)

**Replace:**
- `mark entity current --artifact` → `mark entity test-ready --artifact`
- `mark entity needs-elaboration` → `mark entity spec-needs-elaboration`
- `mark entity review-failed` → deleted (use `test-needs-fixing`)

---

## Execution Strategy

**Option A: Full implementation PR**
- Implement all changes in one go
- Update all tests
- Run full test suite
- (Estimate: ~90 minutes)

**Option B: Incremental (recommended)**
1. Update mark command syntax (30 min)
2. Run existing tests, fix failures (20 min)
3. Add auto-transition logic to resolve (25 min)
4. Add new tests for workflow behaviors (30 min)
5. Validate (15 min)

**Recommendation:** Option B (incremental)

---

**Next action:** Implement Task 1 (mark command update)
