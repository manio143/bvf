# Orphan Handling Design Change (2026-04-01)

## Problem

**Current behavior is unsafe:**
- When spec deleted → manifest entry silently removed
- If test was materialized → lose artifact path, can't clean up test file
- Accidental deletion → no recovery path

## Solution: Preserve orphaned entries

### Updated `resolve` behavior

**For orphaned entries WITH artifacts:**
- ✅ Keep manifest entry (regardless of status)
- ✅ Mark as `status='orphaned'`
- ✅ Warn: "⚠️ entity-name - spec removed but test exists at path"
- ✅ Exit 0 (warning, not error)

**Why artifact check, not status check:**
- Entity could be `(pending, needs-review)` but have artifact from previous materialization
- Artifact field indicates test file was created (needs cleanup)
- Status indicates workflow state (not file existence)

**For orphaned entries WITHOUT artifacts:**
- ✅ Remove manifest entry (never materialized, safe to delete)
- ✅ List in "Orphaned" section
- ✅ Exit 0

### New `remove-orphans` command

```bash
bvf remove-orphans <entity...>      # Remove specific orphaned entries
bvf remove-orphans --all            # Remove all orphaned entries
bvf remove-orphans <entity> --force # Remove even if artifact exists
```

**Safety checks:**
- ❌ Error if entity not orphaned (`status != 'orphaned'`)
- ❌ Error if artifact file still exists (must delete test first)
- ✅ `--force` bypasses artifact check (use with caution)

## Workflow

**Accidental spec deletion:**
```bash
# 1. Notice orphan warning
$ bvf resolve
⚠️  login-test - spec removed but test exists at tests/auth.test.ts

# 2. Restore spec file
$ git restore specs/auth.bvf

# 3. Run resolve again - orphan status cleared
$ bvf resolve
✓ login-test (current, reviewed)
```

**Intentional spec removal:**
```bash
# 1. Delete spec
$ rm specs/auth.bvf

# 2. See orphan warning
$ bvf resolve
⚠️  login-test - spec removed but test exists at tests/auth.test.ts

# 3. Delete test file
$ rm tests/auth.test.ts

# 4. Clean up manifest
$ bvf remove-orphans login-test
Removed orphaned entry: login-test
```

## Specs

**Updated behaviors:**
- `resolve-orphaned-entity-detected` - now preserves entry with status='orphaned'
- `resolve-orphaned-without-artifact-is-deleted` - safe deletion when no artifact

**New command spec:**
- `specs/cli-remove-orphans.bvf` - 7 behaviors covering safety checks and --all flag

**New instrument:**
- `run-remove-orphans(entities?, flags?)` in surfaces.bvf

## Benefits

✅ **Reversible** - restore spec file before cleanup  
✅ **Safe** - can't delete if test exists  
✅ **Explicit** - cleanup requires intentional command  
✅ **Traceable** - orphaned entries visible in manifest  
✅ **Recoverable** - artifact path preserved for manual cleanup  

## Related

- See `BUGS.md` BUG-003 for detailed problem description
- Total behaviors added: 9 (2 resolve + 7 remove-orphans)
- Total behaviors now: 114 (was 103 at start of session)
