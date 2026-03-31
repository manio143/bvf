# BVF Examples Validation Report

## Validation Date
2026-03-31 19:25 UTC

## All Examples Working ✅

After recursive flattening fix (commit `9e4037a`), all 4 example projects correctly display multi-level nested entities.

### 1. Agile Example (`examples/agile/`)

**Config:** epic → story → task/acceptance-criterion

**Status:** ✅ Working  
**Entities found:** 6 materializable (3 tasks + 3 acceptance-criteria)

**Sample output:**
```
user-management (epic)
  user-registration (story)
    ⏳ implement-registration-form (task)
    ⏳ implement-email-verification (task)
    ⏳ registration-validates-email (acceptance-criterion)
    ⏳ registration-requires-strong-password (acceptance-criterion)
  user-login (story)
    ⏳ implement-login-endpoint (task)
    ⏳ login-returns-jwt (acceptance-criterion)
```

### 2. API Testing Example (`examples/api-testing/`)

**Config:** service → endpoint → scenario/contract

**Status:** ✅ Working  
**Entities found:** 7 materializable (4 scenarios + 3 contracts)

**Sample output:**
```
payment-service (service)
  create-charge (endpoint)
    ⏳ create-charge-request-schema (contract)
    ⏳ charge-succeeds-with-valid-token (scenario)
    ⏳ charge-fails-with-expired-token (scenario)
  refund-charge (endpoint)
    ⏳ refund-request-schema (contract)
    ⏳ full-refund-succeeds (scenario)
    ⏳ partial-refund-succeeds (scenario)
    ⏳ refund-fails-on-already-refunded (scenario)
```

### 3. Default Example (`examples/default/`)

**Config:** Standard BVF taxonomy (feature → behavior)

**Status:** ✅ Working  
**Entities found:** 6 materializable (3 behaviors + 3 infrastructure)

**Sample output:**
```
authentication (feature)
  ⏳ login-with-valid-credentials (behavior)
  ⏳ login-with-invalid-password (behavior)
  ⏳ login-remembers-session (behavior)
⏳ web-app (surface)
⏳ logged-out-user (fixture)
⏳ browser-login (instrument)
```

### 4. Documentation Example (`examples/docs/`)

**Config:** module → section → requirement/example

**Status:** ✅ Working  
**Entities found:** 7 materializable (4 requirements + 3 examples)

**Sample output:**
```
authentication (module)
  password-policy (section)
    ⏳ min-password-length (requirement)
    ⏳ password-complexity (requirement)
    ⏳ weak-password-rejected (example)
    ⏳ strong-password-accepted (example)
  session-management (section)
    ⏳ session-timeout (requirement)
    ⏳ concurrent-sessions (requirement)
    ⏳ session-expires-after-inactivity (example)
```

## Key Validation Points

1. ✅ **Multi-level nesting works** - Tasks/scenarios/requirements nested 2-3 levels deep show correctly
2. ✅ **Materializable type inference works** - Leaf types auto-detected without explicit config
3. ✅ **Different taxonomies work** - 4 different domain models all parse correctly
4. ✅ **Summary counts correct** - All leaf entities counted, containers excluded
5. ✅ **No parse errors** - All examples run without errors

## Related Commits

- `9e4037a` - fix: recursive flattening for multi-level entity nesting
- `ce47ddf` - test: delete 7 orphaned tests from old workflow

## Test Coverage

BVF main project: 92 tests, 89 passing (96.7%)
- 3 pre-existing failures with fake hash computation
- All examples validated manually

## Next Steps

Examples demonstrate framework capabilities. Consider:
1. Adding actual test files to show materialization
2. Creating example workflows (spec → test → impl)
3. Adding CI validation for examples
