#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
script="$script_dir/issue-loop.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

check() {
  local name="$1" pattern="$2"
  if grep -Eq "$pattern" "$script"; then
    printf 'PASS %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name" >&2
    exit 1
  fi
}

if ISSUE_LOOP_MODE=invalid "$script" >"$tmp/out" 2>"$tmp/err"; then
  printf 'invalid mode unexpectedly succeeded\n' >&2
  exit 1
fi
grep -Fq 'ISSUE_LOOP_MODE must be legacy or gated' "$tmp/err"
printf 'PASS invalid mode fails before repository access\n'

check 'default legacy mode' 'issue_loop_mode="\$\{ISSUE_LOOP_MODE:-legacy\}"'
check 'legacy OpenCode executor remains' 'opencode_bin.*OPENCODE_BIN'
check 'gated requires both labels' 'label cl-plugin.*label automation-ready'
check 'gated excludes blocked and approval-required' 'gated_issue_has_label.*blocked'
check 'approval checks approver, task, scope, and authority commit' 'APPROVER_LOGINS.*required'
check 'dependencies are fail closed and require merged pull requests' 'closedByPullRequestsReferences.*mergedAt'
check 'Claude is read-only and structured' 'permission-mode plan.*output-format json'
check 'Codex implements and resolves in a worktree' 'worktree add.*gated_worktree'
check 'reviewed commit must be current' 'reviewed_commit_sha.*head'
check 'review cycles are bounded' 'ISSUE_LOOP_MAX_REVIEW_CYCLES'
check 'existing pull requests resume by branch lookup' 'pr list.*--head.*selected_issue_branch'
check 'controller never merges' 'Never merge automatically'
check 'gated path does not destroy primary worktree' 'gated_run\(\)'

if grep -n 'gated_' "$script" | grep -Eq 'reset --hard|clean -fd'; then
  printf 'gated controller contains destructive cleanup\n' >&2
  exit 1
fi
printf 'PASS gated controller contains no destructive cleanup\n'
printf 'gated issue-loop controller tests passed\n'
