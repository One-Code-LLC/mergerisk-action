# Issue-loop controller

`scripts/issue-loop.sh` is the canonical controller. The OpenCode `/issue-loop`
command is only a wrapper around this script.

Legacy is the default and retains the OpenCode executor/reviewer flow:

```bash
ISSUE_LOOP_MODE=legacy scripts/issue-loop.sh 1
```

Gated automation requires `cl-plugin`, `automation-ready`, a valid approval,
and prerequisites closed by merged pull requests. It opens draft pull requests
only and never merges them. Recommended Core Loop configuration:

```bash
ISSUE_LOOP_MODE=gated APPROVER_LOGINS=DaNyNaNd scripts/issue-loop.sh 1
```

Gated overrides are `CODEX_BIN`, `CLAUDE_BIN`, `CODEX_MODEL`, `CLAUDE_MODEL`,
and `ISSUE_LOOP_MAX_REVIEW_CYCLES` (default `3`). Legacy retains
`OPENCODE_BIN`, `EXECUTOR_MODEL`, `REVIEWER_MODEL`, and its timeout overrides.
