# Alignment Fix: mark-current-updates-stale-entity

## Issue
The test `mark-current-updates-stale-entity` in `tests/cli-mark.test.ts` was using manually constructed hashes that didn't match the real hashing algorithm in `src/manifest.ts`.

### Old Approach (WRONG)
```typescript
// Manually computing hashes - doesn't match real algorithm
const oldHash = crypto.createHash('sha256')
  .update('behavior')
  .update('login-test')
  .update('[]')
  .update('    Old test content.\n  ')
  .digest('hex');
```

This manual computation doesn't match how `computeSpecHash()` actually works:
```typescript
// Real algorithm from src/manifest.ts
hash.update(entity.type || '');
hash.update(entity.name || '');
hash.update(JSON.stringify(entity.params || []));
hash.update(entity.body || '');
// Plus context, behaviors, etc.
```

## Solution
Use **status override mechanism** instead of manual hash computation:

### New Approach (CORRECT)
```typescript
// Create manifest with status override to simulate stale state
createManifest(tmpDir, {
  'login-test': {
    type: 'behavior',
    status: 'stale',
    reason: 'content-changed',
    artifact: 'tests/login.test.ts',
    specHash: 'old-content-hash',  // Placeholder, not computed
    dependencyHash: 'old-dep-hash',
    materializedAt: new Date(Date.now() - 10000).toISOString()
  }
});
```

This approach:
1. ✅ Uses placeholder hashes instead of trying to replicate the algorithm
2. ✅ Uses status override (`status: 'stale'`) to mark the entity as stale
3. ✅ Tests that `mark current` will compute **real** hashes using the actual algorithm
4. ✅ Verifies that status override is cleared after marking current

## Test Status
- Test still **fails** (as expected) because `mark current` isn't implemented yet
- Test is now **aligned** with the spec and ready for implementation
- When `mark current` is implemented, this test will pass

## Verification
```bash
npm run build
npx vitest run
# Result: 7 failed | 63 passed (no regressions)
```

All 3 `mark current` tests fail (not implemented), but now use proper test patterns.
