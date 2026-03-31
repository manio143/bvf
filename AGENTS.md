# BVF — Behavioral Verification Framework

## Project Overview

A parser and resolution engine for `.bvf` spec files. The framework parses a DSL
for declaring behavioral specifications (TDD/BDD style), builds a dependency graph
from `@{references}`, validates parameter requirements, tracks materialization state,
and provides a CLI.

## Architecture

```
src/
  parser.ts        — Parse .bvf file content into Entity[] 
  resolver.ts      — Build dependency graph, validate refs, compute hashes
  manifest.ts      — Read/write .bvf-state/manifest.json, track staleness
  config.ts        — Parse bvf.config
  types.ts         — Shared type definitions (Entity, Reference, Param, etc.)
  cli.ts           — CLI entry point (bvf resolve, bvf list, bvf init)
  index.ts         — Public API exports

tests/
  parser.test.ts   — Unit tests for parser
  resolver.test.ts — Unit tests for resolver  
  manifest.test.ts — Unit tests for materialization tracking
  config.test.ts   — Unit tests for config parsing
  cli.test.ts      — Integration tests for CLI commands
```

## Language Spec (BVF DSL)

### Delimiters
- `#decl <type> <name> [params] [clauses]` ... `#end` — top-level entity declaration
- `#decl behavior <name> [params]` ... `#end` — behavior inside a feature
- `#for var in [values]` ... `#end` — parameterized expansion inside a feature
- `#config` ... `#end` — configuration block (in bvf.config)

### Entity declaration line
```
#decl <type> <name>[(<param>, <param> = "default", ...)] [<preposition> @{<ref>}]
```

### References
- `@{name}` — bare reference (valid only if target has no required params)
- `@{name}(key: "value", key: {param})` — parameterized reference
- `{param}` — own parameter usage in body text

### Features
- `#decl feature` can contain nested `#decl behavior` blocks and `#for` expansion blocks
- `#decl behavior` only valid inside a feature
- `#for` wraps one or more `#decl behavior` blocks
- Feature prose (between the feature declaration and first behavior) is inherited by all behaviors in the feature

### Config file (bvf.config)
```
#config
  types: surface, fixture, instrument, behavior, feature
  file-extension: .bvf
  state-dir: .bvf-state
#end
```

## Workflow State Machine

BVF uses a workflow state machine to track specs through review and materialization:

**States:** `(status, reason)`
- `(pending, needs-review)` — New spec, needs soundness review
- `(pending, needs-elaboration)` — Review found gaps, blocked
- `(pending, reviewed)` — Spec approved, ready for materialization
- `(current, needs-review)` — Test materialized, needs alignment review
- `(current, reviewed)` — Complete, test verified

**Commands:**
- `bvf mark <entity> spec-needs-elaboration --note "..."` → (pending, needs-elaboration)
- `bvf mark <entity> spec-reviewed` → (pending, reviewed)
- `bvf mark <entity> test-ready --artifact <path>` → (current, needs-review)
- `bvf mark <entity> test-reviewed` → (current, reviewed)
- `bvf mark <entity> test-needs-fixing --note "..."` → (pending, reviewed)

**Auto-transitions:**
- Spec edit → auto-restart to (pending, needs-review)
- Dependency change → cascade to (pending, needs-review)
- Elaboration complete → (pending, needs-review)

## Conventions
- TypeScript strict mode
- No classes unless clearly needed — prefer functions + interfaces
- Use Result pattern: functions return `{ ok: true, value } | { ok: false, errors: Error[] }`
- Test with vitest
- Run: `npx vitest run`
- Build: `npx tsc`

## Behavioral Specs
The `specs/` directory contains `.bvf` files that describe expected behavior.
Read them to understand what each component should do. The specs are the
source of truth for behavior.
