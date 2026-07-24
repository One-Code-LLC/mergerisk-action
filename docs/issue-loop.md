# Issue-loop controller

`scripts/issue-loop.sh` is the canonical controller. The OpenCode `/issue-loop`
command is only a wrapper around this script.

Gated mode is the default. It requires `cl-plugin`, `automation-ready`, a valid
approval, and prerequisites closed by merged pull requests. It opens draft pull
requests only and never merges them. `APPROVER_LOGINS` is fixed to `DaNyNaNd`.

```bash
issue-loop
issue-loop 3
```

Use `--legacy` (or `-l`) for the OpenCode executor/reviewer workflow:

```bash
issue-loop --legacy 1
```

Legacy defaults are `opencode/north-mini-code-free` for the executor,
`opencode/deepseek-v4-flash-free` for the reviewer, `high` reasoning for both,
a `20m` executor timeout, and a `120` second preflight timeout. Override them
with `--executor-model`, `--reviewer-model`, `--executor-reasoning`,
`--reviewer-reasoning`, `--executor-timeout`, and `--preflight-timeout`.

Gated defaults are `codex`, `claude`, high reasoning for both, three review
cycles, and `${TMPDIR:-/tmp}/issue-loop-worktrees`. Override them with
`--codex-bin`, `--claude-bin`, `--codex-model`, `--claude-model`,
`--codex-reasoning`, `--claude-reasoning`, `--max-review-cycles`, and
`--worktree-root`. Run `issue-loop --help` for the full interface.
