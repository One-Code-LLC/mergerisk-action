# MergeRisk

MergeRisk is a GitHub Action that posts one concise pull request merge-risk report.

It is not a generic AI code reviewer and does not replace human review, tests, or security scanning.

---

## Example

```yaml
name: MergeRisk

on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
            ref: ${{ github.event.pull_request.base.sha }}
      - uses: one-code-llc/mergerisk-action@928924014718afe14ec38fccf4e7fd7dfed38113 # v0.1.1
        with:
          github-token: ${{ github.token }}
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | yes | `${{ github.token }}` | Token used to read PR data and write comments. |
| `provider` | no | `none` | `none`, `openai`, `openai-compatible`, or `anthropic`. |
| `model` | no | empty | Model name for AI synthesis. |
| `api-key` | no | empty | API key for the selected provider. |
| `base-url` | no | empty | Base URL for `openai-compatible` provider (e.g. `https://api.groq.com/openai/v1`). Required when `provider: openai-compatible`. |
| `fail-on-risk` | no | `none` | `none`, `medium`, `high`, or `critical`. |
| `max-patch-lines` | no | `1200` | Maximum patch lines sent to AI synthesis. |
| `comment-mode` | no | `update` | `update` or `new`. |
| `risk-profile-path` | no | empty | Optional YAML file for custom path patterns. |
| `test-review-mode` | no | `auto` | `auto`, `policy`, or `agent`. `auto` uses an agent only when a provider is configured. |
| `test-policy-path` | no | empty | Optional YAML file controlling deterministic test-review decisions. |
| `ai-timeout-ms` | no | `30000` | Request timeout in ms for AI provider calls. |

## Outputs

| Output | Description |
| --- | --- |
| `risk-level` | `low`, `medium`, `high`, or `critical`. |
| `risk-score` | Deterministic numeric risk score. |

## Deterministic Scoring

MergeRisk works without an AI provider. With `provider: none`, scoring is fully deterministic
based on changed file types and diff size:

- **Critical path matches** (auth, payments, database) — each adds 4–5 points.
- **Medium path matches** (API, CI/CD, config) — each adds 2 points.
- **Dependency lockfile changes** — adds 3 points.
- **Broad changes** (20+ files or 500+ lines) — adds 3 points.
- **Required test changes without test evidence** — adds 2 points.

| Score | Risk Level |
| ---: | --- |
| 0–2 | low |
| 3–6 | medium |
| 7–11 | high |
| 12+ | critical |

AI synthesis is optional. When enabled, it summarizes findings but **cannot reduce**
the deterministic risk level.

## Test Review

MergeRisk separates the question “did a test file change?” from “were test changes
required?” The report shows one of three decisions: required, not required, or
inconclusive. Only a high-confidence `required` decision with no changed test
evidence adds the test-risk score.

The default `auto` mode uses the agent when an AI provider is configured; otherwise
it applies the deterministic policy. The built-in policy requires test evidence for
new source files, but not for modifications to existing source files. This avoids
penalizing routine API refactors that do not change behavior.

Use `test-review-mode: policy` to always use deterministic rules, or
`test-review-mode: agent` to require the configured provider. If an agent review
fails in `auto` or `agent` mode, MergeRisk warns and falls back to policy review.

An optional policy file makes the deterministic route repository-specific:

```yaml
test-patterns:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "tests/**"
source-patterns:
  - "src/**/*.{ts,tsx}"
exempt-patterns:
  - "docs/**"
  - "**/*.generated.*"
require-tests-for:
  added-source-files: true
  modified-source-files: false
```

The agent judges whether the patch likely requires a test *change*; it does not
claim to prove coverage is adequate.

## AI Providers

When an AI provider is configured, MergeRisk sends truncated file patches to
synthesize a sharper risk summary. The deterministic risk level is never lowered
by AI output.

### OpenAI

```yaml
- uses: your-org/mergerisk-action@v0
  with:
    github-token: ${{ github.token }}
    provider: openai
    api-key: ${{ secrets.OPENAI_API_KEY }}
```

### Anthropic

```yaml
- uses: your-org/mergerisk-action@v0
  with:
    github-token: ${{ github.token }}
    provider: anthropic
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### OpenAI-Compatible (Groq, Mistral, Together, OpenRouter, Ollama, LM Studio, etc.)

Any provider that speaks the OpenAI Chat Completions format:

```yaml
- uses: your-org/mergerisk-action@v0
  with:
    github-token: ${{ github.token }}
    provider: openai-compatible
    base-url: https://api.groq.com/openai/v1
    api-key: ${{ secrets.GROQ_API_KEY }}
    model: llama-3.3-70b-versatile
```

Local endpoint (Ollama / LM Studio):

```yaml
- uses: your-org/mergerisk-action@v0
  with:
    github-token: ${{ github.token }}
    provider: openai-compatible
    base-url: http://localhost:1234/v1
    api-key: not-needed
    model: qwen2.5-coder-7b-instruct
```

Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or your provider's API key in your repository secrets.

## Failure Threshold

Use `fail-on-risk` to fail the workflow when risk reaches a configured level:

```yaml
- uses: your-org/mergerisk-action@v0
  with:
    github-token: ${{ github.token }}
    fail-on-risk: high
```

Supported values: `none` (default), `medium`, `high`, `critical`.

## Comment Behavior

By default, MergeRisk updates one sticky pull request comment. Each workflow run
rewrites the same comment rather than creating a new one.

- **`comment-mode: update`** (default) — Finds the existing MergeRisk comment
  and updates it. Creates one if none exists.
- **`comment-mode: new`** — Creates a new report comment on every run.

## Permissions

The action needs these permissions:

```yaml
permissions:
  contents: read
  pull-requests: read
  issues: write
```

- `contents: read` — Check out the repository.
- `pull-requests: read` — Read PR changed files and patches.
- `issues: write` — Create or update PR comments (GitHub issues API).

### Fork Pull Requests

When a pull request is opened from a **fork**, GitHub forces `GITHUB_TOKEN`
to **read-only** regardless of the `permissions:` block in your workflow.
This means MergeRisk cannot post or update its report comment on fork PRs
using the default `on: pull_request` trigger.

MergeRisk handles this gracefully:

- It catches the 403 write failure and emits a `warning` explaining the
  limitation.
- It writes the full report to the **job summary** (visible in the workflow
  run page) so results are still accessible.
- The workflow **does not fail** solely because the comment could not be
  posted.

#### Using `pull_request_target` (safe alternative)

If you want MergeRisk to post comments on fork PRs, you can switch to the
`pull_request_target` event. This event runs in the **base** repository
context and grants a writable `GITHUB_TOKEN`.

**Security caveat:** `pull_request_target` runs with the base repo's secrets
and permissions. **Never check out or execute untrusted PR code** when using
this event. Because MergeRisk only reads PR metadata and posts a comment, it
does not execute PR code, so it is safe to use with `pull_request_target`.

```yaml
name: MergeRisk

on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          # Check out the base branch, NOT the merge commit from the fork.
          ref: ${{ github.event.pull_request.base.sha }}
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - uses: your-org/mergerisk-action@v0
        with:
          github-token: ${{ github.token }}
          provider: none
          fail-on-risk: critical
```

> **Important:** The `actions/checkout` step checks out the **base branch**
> (`pull_request.base.sha`), not the fork's merge commit. This prevents any
> untrusted PR code from being executed in your workflow. MergeRisk only reads
> the PR diff via the API — it does not need the PR's working tree.

## Privacy and Safety

- **No hosted backend.** MergeRisk runs entirely in your workflow.
- **No OAuth.** You provide your own GitHub token and model API key.
- **No dashboard.** All output is in PR comments and workflow logs.
- **No repository indexing.** No code or metadata is sent to a third-party service
  beyond the AI provider you explicitly configure.
- **Patch content is truncated** before AI calls. Only the first
  `max-patch-lines` (default 1200) of patch text are sent.
- **API keys are masked** in workflow logs.

## Advisory Scope

MergeRisk is advisory. It triages pull request merge risk to help reviewers
focus. It does not:

- Replace human code review.
- Perform full security scanning.
- Find every bug.
- Make automated code suggestions.

Always review pull requests carefully, especially when MergeRisk reports
**high** or **critical** risk.

## Development

MergeRisk ships a committed `dist/` bundle built with `ncc`. Before merging changes to `src/`, rebuild `dist/` and commit the updated bundle:

```bash
npm run build
git add dist/
git commit -m "chore: rebuild dist bundle"
```

CI verifies that the committed `dist/` matches a fresh build. If it does not, the `build` job fails.

---

[MIT License](LICENSE)
