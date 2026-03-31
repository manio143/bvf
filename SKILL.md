---
name: bvf-workflow
description: >
  Guide an AI agent through the Behavioral Verification Framework (BVF)
  workflow: writing specs, reviewing them for soundness, materializing
  them into executable tests, and reviewing the tests for spec alignment.
  Use when working on a project that uses .bvf spec files to drive
  TDD/BDD development.
---

# BVF Workflow Skill

This skill has two audiences: the **orchestrator** (top-level agent
that talks to the human) and **worker agents** (sub-agents that do
scoped work). Read the section that matches your role.

## Core Principle

**The spec is always right.** If the implementation contradicts the
spec, the implementation is wrong. If a test contradicts the spec,
the test is wrong. Specs change only through human decision, never
through agent convenience.

## Project Layout

```
bvf.config          — entity types, file extension, state directory
specs/              — .bvf files (source of truth)
.bvf-state/
  manifest.json     — tracks materialization status of every entity
src/                — implementation code
tests/              — materialized test code
```

**CLI commands** (available to both orchestrator and workers):
- `bvf resolve` — show current state of all entities
- `bvf list [type] [--feature name]` — browse entities
- `bvf mark <entity> <status> [--note "..."] [--artifact "..."] [--force]` — record review outcomes
  - Statuses: `spec-needs-elaboration`, `spec-reviewed`, `test-ready`, `test-reviewed`, `test-needs-fixing`

---

# Part 1: Orchestrator

You are the top-level agent. You talk to the human, manage the
workflow, and delegate work to sub-agents. You do NOT materialize
tests, write implementation code, or perform reviews yourself.

## Your Responsibilities

1. **Talk to the human** — understand what they want to work on,
   present findings from sub-agents, get approvals for spec changes
2. **Manage the work queue** — read the manifest, decide what to
   work on next, prioritize based on status
3. **Delegate to workers** — spawn sub-agents with reduced scope
   for reviews, materialization, and implementation
4. **Maintain the workflow** — ensure the phases happen in order,
   loop back when reviews fail, don't skip steps

## What You Do NOT Do

- Write test code
- Write implementation code
- Perform reviews yourself
- Modify specs without human approval

You are the manager, not the worker. Your value is in coordination,
not execution.

## The Workflow

There are four phases. They are not strictly linear — soundness
review can loop back into spec elaboration, and alignment review
can loop back into rematerialization.

### Phase 1: Read and Understand Specs

Before delegating anything, understand the landscape yourself.
Run `bvf resolve` to see what needs work. Read the relevant spec
files to understand intent. You need this context to:
- Explain things to the human
- Scope sub-agent tasks correctly
- Evaluate sub-agent reports

### Phase 2: Soundness Review (Pre-Materialization)

For each spec (or batch of related specs) that needs review,
spawn a worker agent with this scope:

```
Review the following BVF spec for soundness:
- [spec file path]
- [referenced entity files, resolved via bvf list]

Check for:
1. Clear expected outcomes (can you tell what to assert?)
2. Logical contradictions
3. Missing supporting specs (instruments, fixtures)
4. Ambiguity in outcomes (not mechanism — mechanism can be abstract)

Report findings as: PASS, NEEDS_ELABORATION (with proposed specs),
or CONTRADICTION (with description).
```

Use the CLI to resolve entity names to file paths so the worker
gets exactly the files it needs. For example:
- `bvf list --feature auth` → find which files contain auth behaviors
- Follow `@{entity-name}` references to include dependency specs

**When the worker reports back:**
- **PASS** → mark as spec-reviewed: `bvf mark <entity> spec-reviewed`
- **NEEDS_ELABORATION** → mark with note: `bvf mark <entity> spec-needs-elaboration --note "..."`, then present proposed specs to human for approval
- **CONTRADICTION** → present both sides to the human, ask for clarification

**After fixing NEEDS_ELABORATION or CONTRADICTION issues:**
Re-run soundness review on the affected specs. Elaborations may
introduce new ambiguities or contradict existing behaviors.
Only proceed to materialization when ALL behaviors pass.

### Phase 3: Test Materialization

Materialize specs into test code FIRST. Tests are written against
the spec, not against existing implementation. They should fail
initially — that's the point.

Mark reviewed specs as ready for materialization:
```bash
bvf mark <entity> spec-reviewed
```

Then spawn a worker agent to materialize specs into test code:

```
Materialize the following BVF specs into test code:
- [spec file path(s)]
- [referenced entity files for context]

Read SKILL.md "Part 2: Worker Agents" for materialization guidance.

Output: test files at [target path]

NOTE: Tests should be written purely from specs. They WILL fail
if the implementation doesn't exist yet — that's expected and correct.
Do NOT look at implementation code to make tests pass. The tests
define what "correct" means, derived from the spec.
```

### Phase 4: Alignment Review (Post-Test-Materialization)

Spawn a **different worker** than the one that materialized.
Independence matters — the author shouldn't review their own work.

```
Review the following materialized test for spec alignment:
- Spec: [spec file path]
- Test: [test file path]
- Referenced specs: [dependency file paths]

Read SKILL.md "Part 2: Worker Agents" for alignment review guidance.

Check: preconditions, assertions, scope.
Report: PASS or FAIL with specific issues.
```

**When the worker reports FAIL:**
1. Run `bvf mark <entity> test-needs-fixing --note "worker's description"`
2. Spawn a new materialization worker with the review note as context
3. After rematerialization, spawn another review worker
4. Repeat until PASS

**When the worker reports PASS:**
Mark tests as reviewed:
```bash
bvf mark <entity> test-reviewed
```

### Phase 5: Implementation

Only after tests are materialized AND pass alignment review,
spawn an implementation worker. The tests are now the acceptance
criteria — the worker's job is to make them pass.

```
Implement the behavior described in these BVF specs:
- [spec file path(s)]
- [test file path(s)] — these are your acceptance criteria
- [existing source files to modify]

The tests define what "correct" means. Make them pass.
Do NOT modify the tests. If a test seems wrong, report back.
```

The implementation worker uses test failures to guide their work.
Red → Green → Refactor. This is textbook TDD.

**When tests still fail after implementation:**
- Check if the failure is an implementation bug (fix it)
- Check if the failure reveals a test/spec mismatch (report back)
- Do NOT modify tests without going through the review cycle

## Scoping Sub-Agent Tasks

The key to effective delegation is **minimal, complete scope**.
Give the worker exactly the files it needs — no more, no less.

**Use the CLI to build scope:**
```bash
# Find all behaviors in a feature
bvf list --feature auth

# Find all entities of a type
bvf list instrument

# See what's stale and why
bvf resolve
```

**Scope includes:**
- The spec file(s) being worked on
- All referenced entity files (follow @{refs} transitively)
- The SKILL.md worker section (for materialization/review guidance)
- Relevant source/test files (for materialization/implementation)

**Scope excludes:**
- Unrelated spec files
- Conversation history
- Other sub-agent outputs (unless relevant)

Smaller scope = faster workers, fewer mistakes, cheaper runs.

## Interrupted Workflows

When the human says "work on the rest" or leaves:
1. Run `bvf resolve` to identify actionable entities
2. Skip `pending:needs-elaboration` (blocked on human)
3. Work through actionable items: review → materialize → review
4. When the human returns, run `bvf resolve` to show status

The manifest is the work queue. No conversation history needed.

## Work Prioritization

1. `pending:needs-elaboration` — needs human approval, skip or ask
2. `pending:reviewed` — ready for materialization
3. `current:needs-review` — tests need alignment review
4. `pending (reviewed)` with note — tests need fixing after failed review
5. Stale entities — spec changed, need re-review

## Working with the Human

The human owns the specs. Workers own the materialization.
You own the coordination.

- **Specs**: Human writes and approves. You relay worker proposals
  (especially instrument elaborations) but never commit them
  without approval.
- **Reviews**: Workers perform. You relay findings and act on them.
- **Manifest**: Everyone reads. Workers and you write status updates.
  The human may mark specs as needing elaboration directly.

---

# Part 2: Worker Agents

You are a sub-agent spawned by the orchestrator with a specific
task. Your scope is limited to the files provided. Do your job,
report back, and stop.

## Reading Specs

Pay attention to:

- **Prose between declarations** — this is design rationale, not filler.
  It explains *why* behaviors exist, what tensions they resolve, and
  what tradeoffs were made.
- **References** (`@{entity-name}`) — understand what the entity
  depends on.
- **Feature context** (`#context`) — shared preconditions inherited
  by all behaviors in the feature.
- **Parameters** — entities with params need tests that exercise
  multiple values, especially defaults and edge cases.

## Soundness Review Task

When asked to review specs for soundness, check:

**Is the expected outcome clear?**
"Exit code is 0" → clear. "The system handles it properly" → unclear.
Abstraction in *mechanism* is fine. Abstraction in *outcome* is not.

**Are there contradictions?**
"Exits with code 0" + "reports an error" might contradict.
Report the specific conflicting statements.

**Do supporting specs exist?**
If a behavior references instruments or fixtures not in your scope
and not in the project, it can't be materialized. Report what's
missing and propose concrete entity definitions.

**Report format:**
```
Entity: <name>
Status: PASS | NEEDS_ELABORATION | CONTRADICTION
Note: <specific description>
Proposed specs (if NEEDS_ELABORATION):
  #decl instrument <name> ...
```

## Materialization Task

Translate specs into executable test code. This is where most
mistakes happen. The two most common failure modes:

**1. Fake preconditions**
The spec says "given all entities are current." You write a test that
hardcodes fake hash values instead of computing real ones. The test
*looks* like it establishes the precondition, but doesn't actually
create the state the spec describes.

*How to avoid:* For every "Given" in the spec, ask: "Does my test
*actually* create this condition, or does it just pretend to?"
If you're using string literals, magic numbers, or mocks where the
real system would compute values — you're faking it.

**2. Wrong assertion methods**
The spec says "a directory is created." You verify with `readFileSync`
which throws on directories. The assertion target is right but the
method is wrong.

*How to avoid:* For every "Then" in the spec, ask: "Is this the
correct API/method to verify this specific kind of outcome?"

**General guidance:**
- One test per behavior. The behavior name becomes the test name.
- Feature context maps to `beforeEach` / shared setup.
- Each "Given" → test setup that *actually establishes* the condition.
- Each "When" → the action under test.
- Each "Then" → one or more assertions using correct methods.
- Don't assert more than the spec says (over-assertion).
- Don't assert less than the spec says (missing assertions).
- **Never write tests that aren't derived from specs.** Every test
  must trace back to a `#behavior` block. If you think a test is
  needed but no spec exists, report back to the orchestrator —
  a spec must be written and approved first.

**After successful materialization:**
Mark tests as ready for alignment review:
```bash
bvf mark <entity> test-ready --artifact tests/my-test.test.ts
```

## Alignment Review Task

Review a materialized test against its spec. You are a reviewer,
not the author. Check three axes:

**Preconditions (Given → test setup)**
Does the test setup actually create the state the spec describes?
Look for fake values, hardcoded strings, or mocks that skip real
computation. If the spec says "entities are current," the test must
use real computed hashes — not `"current-hash-web-app"`.

**Assertions (Then → expect/assert)**
Does the test verify each expected outcome? Using the correct method?
(`existsSync` for directories, not `readFileSync`. Regex for patterns,
not string equality for dynamic output.)

**Scope (spec boundary)**
Does the test verify *only* what the spec describes? Extra assertions
testing implementation details will break on refactors.

**Report format:**
```
Entity: <name>
Status: PASS | FAIL
Issues (if FAIL):
  - [precondition|assertion|scope]: <specific description>
```

Write issues as if someone with no context will read them and need
to fix the test. Good: "test uses hardcoded hash 'abc123' instead
of computing from actual entity content." Bad: "hashes are wrong."

## Implementation Task

When asked to implement code that makes tests pass:

- Read the tests to understand what's expected
- Read the specs to understand the intent behind the tests
- Make the tests pass without modifying them
- If a test seems wrong (contradicts the spec), report back
  to the orchestrator — don't fix the test yourself

## Implementation Review Task

When asked to review implementation code against specs:

This is separate from alignment review (which checks tests against
specs). Here you're checking that the implementation *behaves*
as the spec describes — not that it's tested, but that it's correct.

**What to check:**
- Does the code handle all cases described in the spec's "Then" clauses?
- Does error handling match what the spec says should happen on invalid input?
- Are edge cases from the spec covered (e.g. empty lists, missing keys)?
- Does the code respect constraints mentioned in spec prose (e.g. "forward-compatible", "deterministic")?

**What NOT to check:**
- Code style, naming, or internal structure (not spec concerns)
- Performance (unless the spec explicitly mentions it)
- Things not in the spec (don't invent requirements)

**Report format:**
```
Entity: <name>
Status: PASS | FAIL
Issues (if FAIL):
  - [missing-behavior|wrong-behavior|edge-case]: <specific description>
```

## Advanced Materialization Guidance

### Materializing `#for`-expanded behaviors

Each expansion of a `#for` loop produces a distinct behavior with
substituted values. Materialize each as its own test case:

```typescript
// From: #for email in ["not-an-email", "@missing", "spaces @x.com"]
//       #behavior rejects-invalid-email({email})
it('rejects-invalid-email("not-an-email")', () => { ... });
it('rejects-invalid-email("@missing")', () => { ... });
it('rejects-invalid-email("spaces @x.com")', () => { ... });
```

Alternatively, use parameterized test helpers (`it.each` in vitest/jest)
when the test body is identical except for the substituted value:

```typescript
it.each(['not-an-email', '@missing', 'spaces @x.com'])(
  'rejects-invalid-email("%s")', (email) => { ... }
);
```

Both are acceptable. The key is that every expanded behavior maps
to an executable test case.

### Materializing `#context` with entity references

When a feature's `#context` block references entities (`@{web-app}`),
the shared setup must establish those referenced entities as real
preconditions:

```typescript
describe('registration', () => {
  let app: TestApp;  // from @{web-app}
  
  beforeEach(async () => {
    // Actually create what @{web-app} describes — don't fake it
    app = await startTestApp();
  });
  
  afterEach(async () => {
    await app.stop();
  });
  
  it('valid-registration', () => { ... });
  it('invalid-email', () => { ... });
});
```

The same "no faking preconditions" rule applies: if the context says
`@{web-app}` is running, the setup must actually start it (or use
a real test double that behaves equivalently).

### Handling out-of-scope references

If your assigned spec files reference entities (`@{something}`) that
are NOT in the files provided to you:

1. Check if the referenced entity is in any file you have access to
2. If not, report it:

```
MISSING_DEPENDENCY: @{something} referenced by behavior "my-test"
  Not found in provided files. Orchestrator should include the
  file containing @{something} in scope, or confirm it exists
  in the project.
```

Do NOT guess what the entity contains. Do NOT skip the reference.
Report it and let the orchestrator resolve the scope.

---

# Manifest Reference

| Symbol | Status | Meaning |
|--------|--------|---------|
| ⏳ | pending (needs-review) | New spec, needs soundness review |
| ⏳ | pending (needs-elaboration) | Review found gaps, blocked |
| ⏳ | pending (reviewed) | Spec approved, ready for materialization |
| ⏳ | current (needs-review) | Test materialized, needs alignment review |
| ✓ | current (reviewed) | Complete, test verified |

**Auto-transitions:**
- Spec edit → auto-restart to (pending, needs-review)
- Dependency change → cascade to (pending, needs-review)
- Elaboration added → (pending, needs-review)

**Staleness detection:**
- `bvf resolve` auto-detects changes and updates manifest
- `bvf mark <entity> spec-reviewed` requires `bvf resolve` first (or --force)

# Common Mistakes

1. **Faking preconditions** — use real computation, not string literals
2. **Wrong assertion APIs** — match the method to the thing being verified
3. **Missing assertions** — every "Then" needs a corresponding expect
4. **Over-assertion** — don't test implementation details not in the spec
5. **Ignoring prose** — text between behaviors explains design intent
6. **Modifying specs to match implementation** — the spec is right
7. **Skipping soundness review** — catching problems early saves rework
8. **Vague review notes** — describe the specific issue, not just "broken"
9. **Self-reviewing** — the materializer should not review their own output
10. **Scope creep in workers** — stick to your assigned files
