# BVF Workflow State Machine - Final Design

**Date:** 2026-03-31  
**Status:** Spec complete, ready for implementation

---

## State Storage (Simple)

```typescript
interface ManifestEntry {
  name: string;
  specHash: string;           // Blessed spec hash
  dependencyHash: string;      // Blessed dependency hash
  artifact?: string;           // Test file identifier
  materializedAt?: string;     // Timestamp
  status?: 'pending' | 'current';
  reason?: 'needs-review' | 'needs-elaboration' | 'reviewed';
  note?: string;               // Free-form reviewer notes
}
```

**No additional fields needed.** Three reason values cover all workflow stages.

---

## Commands (Concrete & Specific)

| Command | Status | Reason | Purpose |
|---------|--------|--------|---------|
| `mark spec-needs-elaboration --note "..."` | `pending` | `needs-elaboration` | Soundness review failed |
| `mark spec-reviewed` | `pending` | `reviewed` | Soundness review passed |
| `mark test-ready --artifact <path>` | `current` | `needs-review` | Test materialized |
| `mark test-reviewed` | `current` | `reviewed` | Alignment review passed |
| `mark test-needs-fixing --note "..."` | `pending` | `reviewed` | Alignment review failed |

**Removed:**
- `mark current` → renamed to `mark test-ready`
- `mark needs-elaboration` → renamed to `mark spec-needs-elaboration`
- `mark review-failed` → deleted (replaced by `test-needs-fixing`)

---

## Complete Workflow

```
[New Spec Created]
  ↓
(pending, needs-review)
  ↓
┌─────────────────────────┐
│ Soundness Review        │
└─────────────────────────┘
  ↓
  ├─ PASS → mark spec-reviewed
  │    ↓
  │  (pending, reviewed)
  │    ↓
  │  ┌─────────────────────────┐
  │  │ Materialization         │
  │  └─────────────────────────┘
  │    ↓
  │  mark test-ready --artifact path
  │    ↓
  │  (current, needs-review)
  │    ↓
  │  ┌─────────────────────────┐
  │  │ Alignment Review        │
  │  └─────────────────────────┘
  │    ↓
  │    ├─ PASS → mark test-reviewed
  │    │    ↓
  │    │  (current, reviewed) ✅ DONE
  │    │
  │    └─ FAIL → mark test-needs-fixing --note "..."
  │         ↓
  │       (pending, reviewed)
  │         ↓ (back to materialization)
  │
  └─ FAIL → mark spec-needs-elaboration --note "..."
       ↓
     (pending, needs-elaboration)
       ↓
     [Author edits spec]
       ↓
     resolve auto-detects change
       ↓
     (pending, needs-review)
       ↓ (restart soundness review)
```

---

## Auto-Transitions (resolve writes manifest)

**1. Elaboration completed → re-review**
```typescript
if (entry.reason === 'needs-elaboration' && specHashChanged) {
  entry.specHash = currentSpecHash;
  entry.dependencyHash = currentDepHash;
  entry.reason = 'needs-review';
  // Auto-trigger second soundness pass
}
```

**2. Staleness detected → restart workflow**
```typescript
if ((specHashChanged || depHashChanged) && entry.status) {
  entry.status = 'pending';
  entry.reason = 'needs-review';
  entry.specHash = currentSpecHash;
  entry.dependencyHash = currentDepHash;
  // Keep artifact for context
}
```

**3. Orphaned entity → remove**
```typescript
if (manifestEntry && !specExists) {
  manifest.entries.delete(entityName);
  // Show in "Orphaned" section, then remove
}
```

**This makes `resolve` a write operation.** It updates manifest when auto-transitions occur.

---

## State Meanings

| Status | Reason | Interpretation |
|--------|--------|----------------|
| `pending` | `needs-review` | Awaiting soundness review (new or changed) |
| `pending` | `needs-elaboration` | Soundness failed, author must clarify |
| `pending` | `reviewed` | Soundness passed, ready for test generation |
| `current` | `needs-review` | Test exists, awaiting alignment review |
| `current` | `reviewed` | Test validated, fully complete ✅ |

**Key insight:** Same `reason` values mean different things based on `status`:
- **(pending, reviewed)** = spec is sound, test is pending
- **(current, reviewed)** = test is validated

---

## Design Decisions

### Why concrete command names?
- **User clarity:** `spec-reviewed` vs `test-reviewed` is explicit about WHAT was reviewed
- **Agent clarity:** Materialization agent knows to use `test-ready`, not `current`
- **Prevents errors:** Can't accidentally mark spec as test-reviewed

### Why general state storage?
- **Simplicity:** Only 3 reason values, easy to understand
- **Flexibility:** Same states work in different contexts
- **No schema bloat:** No nested `reviewState` objects

### Why auto-transitions?
- **Safety:** Any change → restart from soundness review (conservative)
- **Automation:** Elaboration → re-review happens automatically
- **Consistency:** Hash mismatch always means "needs-review"

### Why preserve artifact on staleness?
- **Context:** Reviewers can see what test existed before
- **Debugging:** Understand why entity went stale
- **Recovery:** If spec reverts, artifact still known

---

## Implementation Checklist

- [ ] Update CLI command parser for new command names
- [ ] Implement auto-transition logic in `resolve`
- [ ] Make `resolve` write manifest when auto-transitions occur
- [ ] Update tests for new command names
- [ ] Remove old `mark review-failed` command
- [ ] Rename `mark current` → `mark test-ready`
- [ ] Rename `mark needs-elaboration` → `mark spec-needs-elaboration`
- [ ] Add `mark spec-reviewed`, `mark test-reviewed`, `mark test-needs-fixing`

---

## Spec Files Updated

**Commit:** `727e66e`

**Changed:**
- `specs/cli-mark.bvf` — 17 new behaviors documenting workflow
- `specs/cli-resolve.bvf` — updated to match new command names

**Summary:**
- 70 behaviors current (unchanged from previous)
- 17 behaviors pending (new workflow specs)
- 1 behavior stale (mark-nonexistent-entity, content changed)
- **Total: 88 behaviors** (was 78 + 10 new + web-app surface)

---

## What Changed from Original Design

**Simplified:**
- ❌ No `workflowStage` enum
- ❌ No nested `reviewState` object
- ❌ No reviewer/timestamp tracking
- ✅ Just 3 reason values in flat structure

**Clarified:**
- ✅ Concrete command names (spec-reviewed, test-reviewed)
- ✅ General state storage (same reason = different meaning by context)
- ✅ Auto-transitions on change (always restart from needs-review)
- ✅ Orphaned is an event, not a state

**Preserved:**
- ✅ Two review gates (soundness + alignment)
- ✅ Elaboration loop with auto-restart
- ✅ Test-needs-fixing goes back to materialization (not soundness)
- ✅ Staleness cascades to all dependents
- ✅ Artifact preserved for context

---

Ready for implementation!
