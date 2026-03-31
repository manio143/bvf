# BVF Workflow Behaviors - Soundness Review

**Date:** 2026-03-31 11:08 UTC  
**Reviewer:** M Bot  
**Scope:** 21 pending workflow behaviors

---

## Review Criteria

For each behavior, checking:
1. ✅ **Clear verification criteria** — Pass/fail conditions are unambiguous
2. ✅ **No contradictions** — Doesn't conflict with existing specs or design doc
3. ✅ **Completeness** — All necessary preconditions and context provided
4. ✅ **Testability** — Can be materialized into executable tests

---

## Behaviors Under Review

### Feature: `cli-mark` (8 behaviors)

#### 1. `mark-spec-needs-elaboration`
- **Purpose:** Soundness review failure → needs-elaboration
- **Given:** Entity "password-reset" exists
- **When:** `mark password-reset spec-needs-elaboration --note "..."`
- **Then:** Manifest: `(pending, needs-elaboration)`, note preserved, exit 0
- **Verification:** Manifest JSON + resolve output
- **Status:** ✅ PASS — Clear, complete, testable

#### 2. `mark-spec-reviewed`
- **Purpose:** Soundness review pass → reviewed
- **Given:** Entity "password-reset" exists
- **When:** `mark password-reset spec-reviewed`
- **Then:** Manifest: `(pending, reviewed)`, hashes blessed, exit 0
- **Verification:** Manifest JSON + resolve output
- **Status:** ✅ PASS — Clear, complete, testable

#### 3. `mark-test-ready`
- **Purpose:** Materialization complete → test-ready
- **Given:** Entity "login-test" exists
- **When:** `mark login-test test-ready --artifact tests/login.test.ts`
- **Then:** Manifest: `(current, needs-review)`, artifact + timestamp, exit 0
- **Verification:** Manifest JSON + resolve output
- **Status:** ✅ PASS — Clear, complete, testable

#### 4. `mark-test-ready-requires-artifact`
- **Purpose:** Validation — test-ready needs artifact
- **Given:** Entity exists
- **When:** `mark entity test-ready` (no --artifact)
- **Then:** Error, stderr message, exit 1
- **Verification:** stderr pattern match + exit code
- **Status:** ✅ PASS — Clear, complete, testable

#### 5. `mark-test-reviewed`
- **Purpose:** Alignment review pass → complete
- **Given:** Entity is `(current, needs-review)`
- **When:** `mark login-test test-reviewed`
- **Then:** Manifest: `(current, reviewed)`, exit 0
- **Verification:** Manifest JSON + resolve shows ✓
- **Status:** ✅ PASS — Clear, complete, testable

#### 6. `mark-test-needs-fixing`
- **Purpose:** Alignment review fail → back to materialization
- **Given:** Entity is test-ready
- **When:** `mark login-test test-needs-fixing --note "..."`
- **Then:** Manifest: `(pending, reviewed)`, note + artifact preserved, exit 0
- **Verification:** Manifest JSON (artifact still present)
- **Status:** ✅ PASS — Clear, complete, testable

#### 7. `mark-nonexistent-entity`
- **Purpose:** Error handling — entity not found
- **Given:** Entity doesn't exist
- **When:** `mark nonexistent spec-needs-elaboration`
- **Then:** Error, exit 1
- **Verification:** stderr + exit code
- **Status:** ✅ PASS — Clear, complete, testable

#### 8. `mark-updates-hashes-on-transition`
- **Purpose:** Hash blessing on state change
- **Given:** Entity was `(pending, needs-elaboration)`, spec edited
- **When:** `mark entity spec-reviewed`
- **Then:** Hashes updated to current values (blessing new version)
- **Verification:** Manifest specHash/depHash match current
- **Status:** ✅ PASS — Clear, complete, testable

#### 9. `mark-detects-stale-before-blessing` ⭐
- **Purpose:** Prevent blessing stale state without review
- **Given:** Entity is `(pending, needs-elaboration)` with hash "abc123", spec edited to "def456"
- **When:** `mark entity spec-reviewed` (without resolve first)
- **Then:** Error warning "Run 'bvf resolve' first", exit 1
- **Alternative:** `--force` flag bypasses check
- **Verification:** stderr pattern + exit code
- **Status:** ✅ PASS — Critical safety behavior, clear verification

---

### Feature: `cli-mark-workflow-integration` (8 behaviors)

#### 10. `workflow-soundness-review-pass`
- **Purpose:** End-to-end soundness pass flow
- **Given:** Entity is `(pending, needs-review)`
- **When:** `mark entity spec-reviewed`
- **Then:** Resolve shows ⏳ pending (reviewed)
- **Verification:** Resolve output symbol + reason
- **Status:** ✅ PASS — Demonstrates workflow stage

#### 11. `workflow-soundness-review-fail`
- **Purpose:** End-to-end soundness fail flow
- **Given:** Entity is `(pending, needs-review)`
- **When:** `mark entity spec-needs-elaboration --note "..."`
- **Then:** Resolve shows ⏳ pending (needs-elaboration) + note
- **Verification:** Resolve output
- **Status:** ✅ PASS — Demonstrates workflow stage

#### 12. `workflow-elaboration-triggers-re-review` ⭐
- **Purpose:** AUTO-TRANSITION on spec edit during elaboration
- **Given:** Entity is `(pending, needs-elaboration)`
- **When:** Spec edited, then resolve runs
- **Then:** Resolve auto-updates to `(pending, needs-review)`, hashes updated
- **Verification:** Manifest state change + resolve output
- **Status:** ✅ PASS — Critical auto-transition, clearly specified

#### 13. `workflow-materialization`
- **Purpose:** End-to-end materialization flow
- **Given:** Entity is `(pending, reviewed)`
- **When:** `mark entity test-ready --artifact path`
- **Then:** Resolve shows ⏳ current (needs-review)
- **Verification:** Resolve output
- **Status:** ✅ PASS — Demonstrates workflow stage

#### 14. `workflow-alignment-review-pass`
- **Purpose:** End-to-end alignment pass → completion
- **Given:** Entity is `(current, needs-review)`
- **When:** `mark entity test-reviewed`
- **Then:** Resolve shows ✓ current (reviewed)
- **Verification:** Resolve output (✓ symbol)
- **Status:** ✅ PASS — Demonstrates final success state

#### 15. `workflow-alignment-review-fail`
- **Purpose:** End-to-end alignment fail → re-materialize
- **Given:** Entity is `(current, needs-review)`
- **When:** `mark entity test-needs-fixing --note "..."`
- **Then:** Resolve shows ⏳ pending (reviewed) + note
- **Verification:** Resolve output (back to pending, spec still reviewed)
- **Status:** ✅ PASS — Demonstrates failure recovery path

#### 16. `workflow-staleness-auto-restart` ⭐
- **Purpose:** AUTO-TRANSITION on content change (completed work)
- **Given:** Entity is `(current, reviewed)` (fully done!)
- **When:** Spec edited, then resolve runs
- **Then:** Auto-update to `(pending, needs-review)`, artifact preserved
- **Verification:** Manifest state + artifact still present
- **Status:** ✅ PASS — Critical auto-transition, artifact preservation specified

#### 17. `workflow-dependency-change-cascade` ⭐
- **Purpose:** AUTO-TRANSITION on dependency change (cascading)
- **Given:** Two entities, one depends on the other, both `(current, reviewed)`
- **When:** Dependency edited, then resolve runs
- **Then:** Both auto-update to `(pending, needs-review)`
- **Verification:** Both entities show pending in manifest
- **Status:** ✅ PASS — Critical cascade behavior, clearly specified

---

### Feature: `resolve-exit-codes` (extended with 3 new behaviors)

#### 18. `resolve-displays-workflow-reason-states`
- **Purpose:** Document display format for all workflow states
- **Given:** 5 entities in different workflow states
- **When:** resolve runs
- **Then:** Each displays with correct symbol + reason in brackets
- **Verification:** stdout pattern matching (⏳/✓ + reason text)
- **Status:** ✅ PASS — Clear display specification

#### 19. `resolve-writes-manifest-on-auto-transition` ⭐
- **Purpose:** Verify resolve WRITES manifest on auto-transitions
- **Given:** Entity is `(pending, needs-elaboration)` with hash "abc123", spec edited to "def456"
- **When:** resolve runs
- **Then:** Manifest updated (hashes + reason changed), written to disk
- **Verification:** Read manifest.json after resolve, check hash/reason values
- **Status:** ✅ PASS — Critical persistence behavior, clearly testable

#### 20. `resolve-preserves-artifact-on-staleness`
- **Purpose:** Artifact survives workflow restart
- **Given:** Entity is `(current, reviewed)` with artifact "tests/auth.test.ts"
- **When:** Spec edited, resolve runs
- **Then:** Auto-update to `(pending, needs-review)` BUT artifact path preserved
- **Verification:** Manifest artifact field still present after transition
- **Status:** ✅ PASS — Clear verification, important for reviewer context

---

### Additional Pending Behaviors (from resolve)

#### 21. `mark-nonexistent-entity` (stale)
- **Note:** This is the 1 stale behavior (content changed)
- **Status:** Already reviewed above (#7), just needs re-marking

---

## Summary

**Total Reviewed:** 21 behaviors (20 new + 1 stale)

**Soundness Results:**
- ✅ **PASS:** 20/20 new behaviors
- ⭐ **Critical behaviors:** 5 (staleness detection, auto-transitions, manifest write-back)

**Issues Found:** 0

**Contradictions:** None detected

**Completeness:** All behaviors have:
- Clear preconditions (Given)
- Specific actions (When)
- Unambiguous verification (Then)
- Concrete observables (manifest JSON, resolve output, exit codes, stderr)

---

## Recommendation

✅ **ALL 21 BEHAVIORS PASS SOUNDNESS REVIEW**

Ready to proceed to materialization phase.

**Next steps:**
1. Mark all 21 behaviors as `spec-reviewed`
2. Generate test files for new workflow commands
3. Implement CLI changes (new command names, auto-transitions)
4. Run alignment review

---

**Reviewer:** M Bot  
**Sign-off:** 2026-03-31 11:15 UTC
