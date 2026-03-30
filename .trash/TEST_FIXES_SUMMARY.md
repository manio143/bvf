# BVF CLI Test Fixes Summary

## Results
- **Before**: 56/65 tests passing (86%)  
- **After**: 63/65 tests passing (96.9%)
- **Fixed**: 7 failing tests

## Fixed Tests

### 1. ✅ resolve-with-errors
**Issue**: CLI was exiting immediately on resolution errors without printing summary.

**Fix**: Modified `cmdResolve()` to:
- Capture resolution errors in stderr
- Continue to print summary with error count to stdout
- Exit with code 1 after printing summary

### 2. ✅ resolve-with-diff
**Issue**: --diff flag was not implemented.

**Fix**:
- Added `--diff` argument parsing in `cmdResolve()`
- Implemented `showEntityDiff()` function to display content changes
- Shows new lines with `+` prefix when entity is stale and --diff is specified

### 3. ✅ list-all-entities
**Issue**: Entity source files were not shown in output.

**Fix**:
- Added `entity.sourceFile` assignment after parsing each file
- Modified list output to show relative file paths alongside entity names

### 4. ✅ list-by-type
**Issue**: Type argument was not parsed or filtered.

**Fix**:
- Added type argument parsing in `cmdList()`
- Filter entities by type before displaying
- Show appropriate message when no entities of specified type exist

### 5. ✅ list-by-feature
**Issue**: --feature flag was not implemented; behaviors within features were not accessible.

**Fix**:
- Added `--feature <name>` argument parsing
- Extract and display behaviors from the specified feature
- Ensure behaviors have `type: 'behavior'` set

### 6. ✅ list-empty-result
**Issue**: No message shown when filtered list is empty.

**Fix**:
- Added check for empty filtered results
- Display message: "No entities of type 'X' found."

### 7. ✅ init-refuses-existing-project
**Issue**: Init command didn't check for existing config; printed to stdout and exited with code 0.

**Fix**:
- Check for existing `bvf.config` at start of `cmdInit()`
- Print error message to stderr
- Exit with code 1 if project already initialized
- Create `.bvf-state/` directory during init

## Remaining Failures (2)

### ❌ resolve-clean-project
**Issue**: Test uses dummy hash values (`'current-hash-web-app'`, etc.) in manifest that will never match properly computed SHA256 hashes.

**Status**: Cannot fix without modifying test or breaking hash computation system.

**Why it fails**:
```javascript
// Test sets dummy values:
specHash: 'current-hash-web-app'

// CLI computes real SHA256:
specHash: '0be11c3d43224e5393872fbff3e207f22230e2d336f58379f28ced1454860175'

// These will never match → entities always show as stale
```

The CLI is working correctly - it properly computes and compares hashes. To make this test pass would require either:
1. Modifying the test to use actual computed hashes (not allowed)
2. Breaking the hash system to accept arbitrary values (defeats the purpose)

### ❌ init-creates-config  
**Issue**: Test bug - lines 398-399 call `readFileSync()` on directories, which throws `EISDIR` error.

**Status**: Task explicitly states: "The test has a BUG... The test WILL fail on that line."

**What we did**: Successfully created `.bvf-state/` directory as required. Test fails on the buggy line before checking, but the implementation is correct.

## Key Changes to src/cli.ts

1. **Updated function signatures**: Added `cmdArgs` parameter to `cmdResolve()` and `cmdList()`
2. **Error handling**: Errors now print to stderr with summary still shown to stdout
3. **Diff support**: Implemented content diff display for stale entities
4. **Enhanced list**: Added type filtering, feature filtering, and source file display
5. **Robust init**: Added existing project check with proper error handling
6. **Directory creation**: Ensured `.bvf-state/` directory is created during init

## Test Coverage

| Test Suite | Tests | Passing | Failing |
|------------|-------|---------|---------|
| parser.test.ts | 18 | 18 | 0 |
| resolver.test.ts | 14 | 14 | 0 |
| config.test.ts | 13 | 13 | 0 |
| manifest.test.ts | 10 | 10 | 0 |
| cli.test.ts | 10 | 8 | 2 |
| **Total** | **65** | **63** | **2** |

All core functionality tests pass. Only 2 CLI integration tests fail due to test design issues, not implementation problems.
