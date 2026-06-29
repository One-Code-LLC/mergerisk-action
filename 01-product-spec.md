# MergeRisk Action Product Spec

## Product

MergeRisk is a GitHub Action that comments on pull requests with a concise risk report. It is not a generic AI code reviewer. Its job is to answer one question before a human reviews or merges:

> How risky is this pull request, and where should reviewers focus?

## Target Customer

Primary target: small engineering teams with 3-30 developers using GitHub and AI coding agents.

Secondary target: individual senior engineers who want a low-friction CI check for their own repositories.

The MVP should optimize for team adoption, but the launch path should be friendly to individuals:

- easy `uses:` installation
- no hosted account required
- bring your own OpenAI or Anthropic key
- useful deterministic risk output even when no model key is configured

## Positioning

Avoid these claims:

- "AI code reviewer"
- "replaces human review"
- "finds every bug"
- "security scanner"

Use this positioning:

- "PR risk triage for teams shipping with coding agents"
- "One concise merge-risk report per pull request"
- "Highlights blast radius, reviewer focus areas, and missing validation evidence"

## MVP Behavior

When a pull request is opened, synchronized, reopened, or marked ready for review, the Action:

1. Reads pull request metadata.
2. Reads the changed files list and file patches.
3. Classifies changed files into risk categories.
4. Applies deterministic risk rules.
5. Computes an overall risk level: `low`, `medium`, `high`, or `critical`.
6. Optionally calls an LLM to synthesize the findings into a sharper summary.
7. Posts or updates one sticky PR comment.
8. Optionally fails the workflow when risk is at or above a configured threshold.

## Risk Categories

The first version should detect these categories:

- Authentication and authorization changes
- Payment and billing changes
- Database migrations and schema changes
- Public API changes
- CI/CD and deployment changes
- Dependency changes
- Configuration and environment changes
- Security-sensitive files
- Large or broad changes
- Missing or weak test evidence

## Report Shape

The PR comment should have this structure:

```markdown
## MergeRisk Report

**Overall risk:** high
**Merge guidance:** Senior review recommended before merge.

### Why This PR Is Risky
- Database migration changed without nearby rollback or compatibility notes.
- Authentication middleware changed.
- No test files changed.

### Reviewer Focus
- `src/auth/session.ts`
- `migrations/202606290915_add_org_roles.sql`

### Risk Signals
| Signal | Severity | Evidence |
| --- | --- | --- |
| Database schema change | high | `migrations/202606290915_add_org_roles.sql` |
| Auth-sensitive file | high | `src/auth/session.ts` |
| Missing test evidence | medium | No files matched test patterns |

### Suggested Checklist
- Confirm migration is backward-compatible.
- Confirm auth behavior for existing sessions.
- Add or identify tests covering role changes.
```

## Configuration

The Action should accept these inputs:

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | yes | `${{ github.token }}` | Token used to read PR data and write comments. |
| `provider` | no | `none` | `none`, `openai`, or `anthropic`. |
| `model` | no | provider default | Model name for LLM synthesis. |
| `api-key` | no | empty | API key for the selected provider. |
| `fail-on-risk` | no | `none` | `none`, `medium`, `high`, or `critical`. |
| `max-patch-lines` | no | `1200` | Maximum patch lines sent to the model. |
| `comment-mode` | no | `update` | `update` or `new`. |
| `risk-profile-path` | no | empty | Optional YAML file for custom path patterns. |

## Default Path Rules

The MVP should ship with built-in patterns:

```yaml
auth:
  severity: high
  patterns:
    - "**/auth/**"
    - "**/session/**"
    - "**/middleware/**"
    - "**/*auth*"
payments:
  severity: high
  patterns:
    - "**/billing/**"
    - "**/payments/**"
    - "**/stripe/**"
database:
  severity: high
  patterns:
    - "**/migrations/**"
    - "**/schema.sql"
    - "**/prisma/schema.prisma"
api:
  severity: medium
  patterns:
    - "**/api/**"
    - "**/routes/**"
    - "**/controllers/**"
ci_cd:
  severity: medium
  patterns:
    - ".github/workflows/**"
    - "Dockerfile"
    - "docker-compose*.yml"
dependencies:
  severity: medium
  patterns:
    - "package-lock.json"
    - "pnpm-lock.yaml"
    - "yarn.lock"
    - "poetry.lock"
    - "Gemfile.lock"
config:
  severity: medium
  patterns:
    - "**/.env*"
    - "**/config/**"
    - "**/*.config.*"
tests:
  severity: info
  patterns:
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/__tests__/**"
    - "tests/**"
```

## Scoring Model

Use deterministic scoring first:

| Signal | Points |
| --- | ---: |
| Critical path match | 5 |
| High path match | 4 |
| Medium path match | 2 |
| Dependency lockfile changed | 3 |
| More than 20 files changed | 3 |
| More than 500 added or deleted lines | 3 |
| No test files changed | 2 |
| CI/CD changed | 3 |

Risk thresholds:

| Score | Level |
| ---: | --- |
| 0-2 | low |
| 3-6 | medium |
| 7-11 | high |
| 12+ | critical |

The LLM may rewrite and prioritize the report, but it must not lower deterministic severity. If the deterministic risk is `high`, the final risk cannot become `medium`.

## Privacy And Safety

The MVP must:

- avoid logging model API keys
- avoid logging full diffs by default
- truncate patch content before sending to LLMs
- work without an LLM provider
- clearly state that it is advisory and not a replacement for review, tests, or security scanning

## Non-Goals

Do not build these in the first version:

- OAuth
- dashboard
- hosted backend
- billing
- repository indexing
- full static analysis engine
- line-by-line PR comments
- automatic code suggestions
- long-term storage
- organization policy management

## Launch Package

The MVP should include:

- `README.md` with installation examples
- `action.yml`
- typed TypeScript source
- unit tests for scoring and markdown report generation
- integration-style tests for GitHub comment update logic using mocks
- example workflow file
- license
- marketplace-friendly branding metadata in `action.yml`

## Success Criteria

The MVP is ready to launch when:

- It runs on a test pull request.
- It posts one well-structured sticky comment.
- It works with `provider: none`.
- It works with one model provider.
- It can fail the workflow based on configured risk threshold.
- Tests cover deterministic scoring, report rendering, config parsing, and comment update behavior.
- README installation takes less than five minutes to follow.
