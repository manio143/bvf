# BVF — Behavioral Verification Framework

A TDD/BDD framework that uses declarative `.bvf` spec files to drive test generation and implementation.

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Run tests
npm test

# Check project status
npx bvf resolve

# List entities
npx bvf list behavior

# Initialize a new project
npx bvf init
```

## Core Concepts

**Specs define behavior** — Write `.bvf` files describing what your system should do, not how it should do it.

**Tests materialize from specs** — Generate executable tests directly from behavioral specifications.

**Workflow tracks progress** — State machine tracks each spec through soundness review, materialization, alignment review, and implementation.

## BVF Language

### Entity Declaration

```bvf
#decl behavior user-login on @{web-app}
  Given a registered user with valid credentials.
  When they POST to /api/auth/login with email and password.
  Then response contains a JWT token.
  And response status is 200.
#end
```

### References & Parameters

```bvf
#decl instrument http-client(base-url = "http://localhost:3000")
  Makes HTTP requests to a server.
#end

#decl behavior api-call
  When @{http-client}(base-url: "https://api.example.com") GETs "/users".
  Then response status is 200.
#end
```

### Features & Context

```bvf
#decl feature authentication on @{web-app}

  #context
    Given @{web-app} is running.
    And database is clean.
  #end

  #behavior login-succeeds
    When user submits valid credentials.
    Then they receive a JWT token.
  #end

  #behavior login-fails
    When user submits invalid credentials.
    Then response status is 401.
  #end

#end
```

### Parameterized Expansion

```bvf
#decl feature validation on @{api}

  #for email in ["not-an-email", "@missing-local", "spaces @x.com"]
    #behavior rejects-invalid-email({email})
      When POST /register with email = "{email}".
      Then response status is 400.
      And error says "invalid email format".
    #end
  #end

#end
```

## Configuration

Create `bvf.config` in your project root:

```bvf
#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
  materializable: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
```

- **types** — Entity types used in your project
- **containment** — Which types can contain others (e.g., features contain behaviors)
- **materializable** — Which types get materialized into tests (tracked in manifest)
- **file-extension** — What extension spec files use (default: `.bvf`)
- **state-dir** — Where to store manifest and state (default: `.bvf-state`)

### Materializable Types

When `materializable` is omitted, BVF infers it as: **leaf types** (children that never appear as parents) + **standalone types** (not mentioned in containment).

**Example:**
```bvf
#config
  types: epic, story, task, acceptance-criterion
  containment:
    epic: story
    story: task, acceptance-criterion
#end
```

**Inferred materializable:** `task`, `acceptance-criterion` (leaves)

## Workflow Commands

BVF uses a state machine to track specs through review and materialization:

### Mark Commands

```bash
# After soundness review finds gaps
bvf mark <entity> spec-needs-elaboration --note "Missing fixture definition"

# After soundness review passes
bvf mark <entity> spec-reviewed

# After test materialization completes
bvf mark <entity> test-ready --artifact tests/my-test.test.ts

# After alignment review passes
bvf mark <entity> test-reviewed

# After alignment review finds issues
bvf mark <entity> test-needs-fixing --note "Fake hash values in setup"
```

### Status Display

```bash
$ bvf resolve

  authentication (feature)
    ⏳ login-succeeds (behavior)
        [needs-review]
    ⏳ login-fails (behavior)
        [needs-elaboration] Missing @{http-client} definition
    ✓ logout-succeeds (behavior)
        [reviewed]

Summary:
  Current: 1
  Pending: 2
  Total: 3
```

**Symbols:**
- ⏳ `pending (needs-review)` — New spec, awaiting soundness review
- ⏳ `pending (needs-elaboration)` — Review found gaps, blocked
- ⏳ `pending (reviewed)` — Spec approved, ready for materialization
- ⏳ `current (needs-review)` — Test materialized, needs alignment review
- ✓ `current (reviewed)` — Complete, test verified

### Auto-Transitions

BVF automatically detects changes and updates workflow state:

- **Spec edited** → auto-restart to `(pending, needs-review)`
- **Dependency changed** → cascade to `(pending, needs-review)`
- **Elaboration added** → restart to `(pending, needs-review)`

Run `bvf resolve` to trigger detection and update the manifest.

## Project Layout

```
my-project/
├── bvf.config              # Configuration
├── specs/                  # .bvf spec files (source of truth)
│   ├── api.bvf
│   └── auth.bvf
├── .bvf-state/
│   └── manifest.json       # Tracks materialization status
├── tests/                  # Generated from specs
│   ├── api.test.ts
│   └── auth.test.ts
└── src/                    # Implementation
    └── ...
```

## Workflow Phases

### 1. Write Specs

Create `.bvf` files describing behavior in `specs/`:

```bvf
#decl behavior user-can-register on @{web-app}
  When user POSTs to /api/register with valid data.
  Then response status is 201.
  And user record is created in database.
#end
```

### 2. Soundness Review

Check specs for clarity, contradictions, and completeness:

```bash
$ bvf resolve
⏳ user-can-register (behavior)
    [needs-review]
```

Review the spec. If sound:
```bash
$ bvf mark user-can-register spec-reviewed
```

If missing supporting specs:
```bash
$ bvf mark user-can-register spec-needs-elaboration \
  --note "Missing @{web-app} definition"
```

### 3. Materialize Tests

Generate executable tests from specs:

```typescript
// tests/auth.test.ts (generated from spec)
it('user-can-register', async () => {
  const app = await startTestApp();
  const response = await app.post('/api/register', {
    email: 'user@example.com',
    password: 'secure123'
  });
  
  expect(response.status).toBe(201);
  const user = await db.users.findOne({ email: 'user@example.com' });
  expect(user).toBeDefined();
});
```

Mark as ready:
```bash
$ bvf mark user-can-register test-ready --artifact tests/auth.test.ts
```

### 4. Alignment Review

Verify tests match specs:

- Do preconditions match the "Given" clauses?
- Do assertions cover all "Then" clauses?
- Are correct verification methods used?

If aligned:
```bash
$ bvf mark user-can-register test-reviewed
```

If misaligned:
```bash
$ bvf mark user-can-register test-needs-fixing \
  --note "Using fake hash values instead of computed ones"
```

### 5. Implementation

Make the tests pass by implementing the behavior:

```bash
$ npm test
FAIL tests/auth.test.ts
  ✗ user-can-register
    POST /api/register → 404 Not Found

# Implement the endpoint...

$ npm test
PASS tests/auth.test.ts
  ✓ user-can-register
```

## Examples

See `examples/` for different project configurations:

- **default** — Standard BVF taxonomy (surface, fixture, instrument, behavior, feature)
- **agile** — Agile project (epic, story, task, acceptance-criterion)
- **api-testing** — API specs (service, endpoint, contract, scenario)
- **docs** — Documentation (module, section, requirement, example)

## CLI Reference

```bash
bvf resolve                     # Show project status
bvf resolve --diff              # Machine-readable format (materializable only)

bvf list [type]                 # List all entities (or filter by type)
bvf list --feature <name>       # List entities in a feature

bvf init                        # Initialize new BVF project

bvf mark <entity> <status>      # Update workflow state
  --note "..."                  # Add a note (for needs-elaboration, needs-fixing)
  --artifact <path>             # Set artifact path (for test-ready)
  --force                       # Skip staleness check
```

**Statuses:**
- `spec-needs-elaboration`
- `spec-reviewed`
- `test-ready`
- `test-reviewed`
- `test-needs-fixing`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit
```

## License

MIT
