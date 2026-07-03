# MergeRisk

MergeRisk is a GitHub Action that posts one concise pull request merge-risk report.

It is not a generic AI code reviewer and does not replace human review, tests, or security scanning.

---

## Example

```yaml
name: MergeRisk

on:
  pull_request:
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
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - uses: your-org/mergerisk-action@v0
        with:
          github-token: ${{ github.token }}
          provider: none
          fail-on-risk: critical
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | yes | `${{ github.token }}` | Token used to read PR data and write comments. |
| `provider` | no | `none` | `none`, `openai`, or `anthropic`. |
| `model` | no | empty | Model name for AI synthesis. |
| `api-key` | no | empty | API key for the selected provider. |
| `fail-on-risk` | no | `none` | `none`, `medium`, `high`, or `critical`. |
| `max-patch-lines` | no | `1200` | Maximum patch lines sent to AI synthesis. |
| `comment-mode` | no | `update` | `update` or `new`. |
| `risk-profile-path` | no | empty | Optional YAML file for custom path patterns. |

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
- **Missing test evidence** — adds 2 points.

| Score | Risk Level |
| ---: | --- |
| 0–2 | low |
| 3–6 | medium |
| 7–11 | high |
| 12+ | critical |

AI synthesis is optional. When enabled, it summarizes findings but **cannot reduce**
the deterministic risk level.

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

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in your repository secrets.

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

---

[MIT License](LICENSE)
