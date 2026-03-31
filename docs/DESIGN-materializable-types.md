# BVF Config Evolution: Optional Nesting & Materializable Types

## The Problem

Currently the config has two concepts:
- `types` — what entity types exist
- `containment` — what can nest inside what

Missing:
1. **What is materializable?** The framework needs to know which types represent testable behaviors (tracked in manifest, counted in summary) vs structural types (grouping, context, infrastructure).
2. **Optional nesting** — behaviors can live directly under a feature OR be grouped by an intermediate type (e.g. `group`) without that group being materializable itself.

## Current Config

```
#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
```

The framework currently infers:
- **Container types** = parents in containment (feature)
- **Leaf types** = children not also parents (behavior)
- **Standalone types** = not in containment at all (surface, fixture, instrument)
- **Counted in summary** = leaf + standalone

This inference is fragile. Is `instrument` really materializable? Is `surface`? The framework guesses but the user knows.

## Proposal: Explicit `materializable` Key

```
#config
  types: surface, fixture, instrument, behavior, feature, group
  containment:
    feature: behavior, group
    group: behavior
  materializable: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
```

### What `materializable` does:
- Lists types that represent testable work items
- Only these types are counted in summary (Current/Pending/Stale)
- Only these types get manifest entries
- Only these types show up in `--diff` output
- Everything else is structural (grouping, infrastructure, context)

### What this enables:

**Optional grouping via `group` type:**
```bvf
#decl feature authentication on @{web-app}
  
  #decl behavior basic-login
    User logs in with email/password.
  #end

  #decl group edge-cases
    #decl behavior expired-password
      User with expired password is prompted to reset.
    #end
    
    #decl behavior locked-account
      User sees lockout message after 5 failed attempts.
    #end
  #end
#end
```

Here `group` is:
- Allowed inside `feature` (per containment)
- Contains behaviors (per containment)
- NOT materializable — it's purely organizational
- Doesn't get a manifest entry
- Doesn't count in summary
- Just a way to visually group related behaviors

**Without `materializable`, the framework would wrongly try to track `group` as a leaf type** (it's a child of feature but also a parent of behavior — actually it's both, so it wouldn't be leaf. But `surface` and `fixture` would still be wrongly counted.)

### Inference vs explicit

If `materializable` is omitted, the framework could fall back to the current inference (leaf + standalone types). But having it explicit is better:
- `instrument` describes HOW to test — not a test itself → not materializable
- `fixture` describes test setup — not a test itself → not materializable  
- `surface` describes what's being tested — not a test → not materializable
- Only `behavior` (or `scenario`, `acceptance-criterion`, etc.) is a test → materializable

### What changes in resolve output

With `materializable: behavior`:
```
Summary:
  Current: 12    ← only behaviors
  Pending: 3     ← only behaviors
  Stale: 1       ← only behaviors
  Errors: 0
  Total: 16      ← only behaviors
```

Structural types still appear in the tree output (for context) but don't affect counts.

## Multi-level Optional Nesting

The containment rules already support this:
```
containment:
  feature: behavior, group
  group: behavior
```

This means behaviors can live:
- Directly under a feature: `feature → behavior` ✅
- Under a group under a feature: `feature → group → behavior` ✅
- Not at top level (not in containment as child of nothing)

The group is **optional** — you can have features with a mix:
```bvf
#decl feature payments on @{api}
  #decl behavior charge-succeeds
    Happy path.
  #end
  
  #decl group error-handling
    #decl behavior charge-fails-invalid-card
      Invalid card number.
    #end
    #decl behavior charge-fails-insufficient-funds
      Not enough money.
    #end
  #end
#end
```

## Display Implications

The resolve tree shows non-materializable types (like features and groups) **without status symbols**:

```
  payments (feature)
    ✓ charge-succeeds (behavior)
    error-handling (group)
      ⏳ charge-fails-invalid-card (behavior)
      ⏳ charge-fails-insufficient-funds (behavior)
```

**Key behavior:**
- Non-materializable types appear in tree for context but have NO status symbol
- Only materializable types (e.g., `behavior`) get ✓/✗/⏳ symbols
- Containers (features, groups) provide structural hierarchy
- Indentation shows nesting relationships

## Alternative: Use `#group` as Syntax Sugar

Instead of making `group` a full type, it could be a lightweight syntax construct:

```bvf
#decl feature payments on @{api}
  #group error-handling
    #decl behavior charge-fails-invalid-card
      ...
    #end
  #end
#end
```

But this adds a new parser concept. The generic approach (just another type) is more consistent and requires no parser changes — it works today if you add `group` to types and containment.

## Summary of Config Changes

| Key | Required? | Purpose |
|-----|-----------|---------|
| `types` | Yes | Valid entity type names |
| `containment` | No | Nesting rules |
| `materializable` | No | Types tracked in manifest + counted |
| `file-extension` | No | Default `.bvf` |
| `state-dir` | No | Default `.bvf-state` |

If `materializable` is omitted, infer from containment (leaf + standalone). If present, use explicitly listed types only.

## Performance

**Resolve performance** (measured on BVF's own specs, 86 entities):
- **Average**: 40ms per run
- **First run**: 92ms (cold start)
- **Subsequent runs**: 38-42ms (warmed up)
- Scales linearly with entity count + file I/O

This makes `resolve` suitable for tight feedback loops (mark → resolve → verify).

## New Behaviors to Spec

All behaviors have been implemented and verified ✅:

1. ✅ `config-accepts-materializable-key` — parse and validate the key
2. ✅ `config-materializable-must-be-subset-of-types` — error if unknown type listed
3. ✅ `resolve-counts-only-materializable` — summary counts only materializable types
4. ✅ `resolve-shows-non-materializable-in-tree` — structural types in tree but no ✓/✗/⏳
5. ✅ `resolve-diff-excludes-non-materializable` — `--diff` excludes non-materializable entities
6. ✅ `config-materializable-defaults-to-inference` — when omitted, current leaf+standalone logic applies
7. ✅ `config-group-type-allows-optional-nesting` — groups enable optional organizational nesting
8. ✅ `resolve-displays-group-as-header` — groups appear as indented headers without status symbols

**Implementation status:** 78/78 tests passing (Round 6 complete)

## Design Decisions (Resolved)

1. **Name**: `materializable` chosen over alternatives (trackable, testable, leaf, workitems)
   - Clearest intent: "what gets materialized into tests/artifacts"
   - Aligns with BVF's materialization phase terminology

2. **`bvf list` behavior**: Non-materializable types included by default
   - Provides full context for navigation
   - Can be filtered with type-specific queries if needed

3. **`--diff` filtering**: Non-materializable types excluded
   - Agent tooling needs actionable items only
   - Reduces noise in automated workflows

4. **`group` naming**: Convention, not reserved keyword
   - Any type can serve as optional grouping container
   - Generic approach = more flexible (e.g., `category`, `module`, `subfeature`)

