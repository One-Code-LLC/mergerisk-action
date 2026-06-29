# MergeRisk Agent Task Backlog

Use this as the task list for small-model implementation. Each task maps to the implementation plan in `docs/superpowers/plans/2026-06-29-mergerisk-action.md`.

## Milestone 1: Deterministic Local Core

### Issue 1: Scaffold Node TypeScript GitHub Action

Acceptance criteria:

- `npm install` completes.
- `npm test` runs.
- `npm run typecheck` runs.
- Project has `package.json`, `tsconfig.json`, `vitest.config.ts`, and `.gitignore`.

Implementation plan section: Task 1.

### Issue 2: Define Domain Types

Acceptance criteria:

- `src/types.ts` defines config, PR file, risk signal, and risk assessment types.
- `npm run typecheck` passes.

Implementation plan section: Task 2.

### Issue 3: Parse Action Configuration

Acceptance criteria:

- Defaults work for provider, risk threshold, patch limits, and comment mode.
- Unsupported providers throw clear errors.
- Provider API key is required when provider is not `none`.
- Tests pass.

Implementation plan section: Task 3.

### Issue 4: Classify Changed Files

Acceptance criteria:

- Built-in rules classify auth, payments, database, API, CI/CD, dependencies, config, and tests.
- Evidence filenames are retained on signals.
- Tests pass.

Implementation plan section: Task 4.

### Issue 5: Score Pull Request Risk

Acceptance criteria:

- Risk levels are deterministic.
- Missing test evidence adds a signal.
- Broad and large diffs add signals.
- Tests cover low, high, and critical outcomes.

Implementation plan section: Task 5.

## Milestone 2: Pull Request Report

### Issue 6: Render Markdown Report

Acceptance criteria:

- Report includes sticky marker `<!-- mergerisk-report -->`.
- Report includes risk level, score, guidance, signals table, reviewer focus, and checklist.
- Tests pass.

Implementation plan section: Task 6.

### Issue 7: Fetch Pull Request Changed Files

Acceptance criteria:

- Function returns filename, status, additions, deletions, changes, and patch.
- Pagination is used.
- Typecheck passes.

Implementation plan section: Task 7.

### Issue 8: Upsert Sticky GitHub Comment

Acceptance criteria:

- Existing MergeRisk comment is updated in `update` mode.
- A new comment is created when none exists.
- `new` mode always creates a new comment.
- Tests pass.

Implementation plan section: Task 8.

## Milestone 3: Optional AI And Action Runtime

### Issue 9: Add Optional AI Synthesis

Acceptance criteria:

- `provider: none` returns no synthesized summary.
- OpenAI provider calls Chat Completions API.
- Anthropic provider calls Messages API.
- Patch content is truncated to `max-patch-lines`.
- Typecheck passes.

Implementation plan section: Task 9.

### Issue 10: Wire Action Entrypoint

Acceptance criteria:

- Action exits early on non-PR events.
- On PR events, it fetches files, scores risk, renders report, posts comment, and sets outputs.
- `fail-on-risk` fails the workflow at or above threshold.
- Typecheck passes.

Implementation plan section: Task 10.

### Issue 11: Add Action Metadata And CI

Acceptance criteria:

- `action.yml` uses Node 24 and points to `dist/index.js`.
- Example workflow is present.
- CI runs install, tests, typecheck, and build.
- Build produces `dist/index.js`.

Implementation plan section: Task 11.

## Milestone 4: Launch Readiness

### Issue 12: Add README And License

Acceptance criteria:

- README explains positioning, installation, inputs, outputs, permissions, and provider setup.
- README says MergeRisk is advisory.
- MIT license is present.

Implementation plan section: Task 12.

### Issue 13: Verify Locally

Acceptance criteria:

- `npm test` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
- `dist/index.js` exists.

Implementation plan section: Task 13.

### Issue 14: Smoke Test On GitHub Pull Request

Acceptance criteria:

- Test repository PR triggers the Action.
- One MergeRisk report comment is posted.
- Re-running updates the same comment.
- Auth file change is reported as high risk or higher.

Implementation plan section: Task 14.

## Delegation Notes

Give one issue at a time to a small model. Require it to:

- read only the named implementation-plan task before coding
- follow the tests-first steps
- stop after the acceptance criteria pass
- report exact files changed and exact commands run
- avoid adding dashboard, billing, OAuth, or hosted backend features

## Product Decisions Locked For MVP

- Node 24 TypeScript Action.
- Bring your own model key.
- Deterministic scoring is always available.
- AI synthesis is optional.
- One sticky PR comment, not line comments.
- No SaaS backend in v0.1.
