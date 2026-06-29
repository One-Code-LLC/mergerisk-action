#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s [issue-count]\n' "$(basename "$0")"
  printf '\n'
  printf 'Selects the next oldest unclaimed MergeRisk GitHub issue, has /issue-executor-pr fix and commit it, publishes the PR, then runs /review-branch.\n'
  printf 'issue-count must be a positive integer and defaults to 1.\n'
  printf 'Uses OPENCODE_REPO when set; otherwise derives owner/repo from the origin remote.\n'
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if (( $# > 1 )); then
  usage >&2
  exit 64
fi

issue_count="${1:-1}"
if ! [[ "$issue_count" =~ ^[1-9][0-9]*$ ]]; then
  printf 'issue-count must be a positive integer; got: %s\n' "$issue_count" >&2
  usage >&2
  exit 64
fi

# Load repo-root .env (if present) so model/timeout overrides can live there
# instead of the caller's shell. set -a exports every assignment so the
# ${VAR:-default} reads below pick them up. Note: a value in .env overrides one
# already exported in the shell - to override for a single run, edit .env.
# ponytail: source the file directly; these values are simple KEY=VALUE pairs.
env_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/.env"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

opencode_bin="${OPENCODE_BIN:-opencode}"
# Wall-clock cap per executor run so a runaway/looping executor (e.g. one
# repeating the same git log forever) is abandoned instead of hanging the
# whole batch. Default 20m; override with EXECUTOR_TIMEOUT (timeout(1) format,
# e.g. 1200s, 30m). macOS ships no `timeout`; fall back to coreutils gtimeout,
# else run unguarded with a warning.
executor_timeout="${EXECUTOR_TIMEOUT:-20m}"
# Executor model. The default free model occasionally goes unresponsive
# (returns no tokens for the full timeout); override to a working model with
# EXECUTOR_MODEL, e.g. opencode/deepseek-v4-flash-free.
executor_model="${EXECUTOR_MODEL:-opencode/north-mini-code-free}"
# Preflight cap (seconds). The preflight makes the model complete a full tool
# call (write a sentinel file), so it needs more headroom than a one-token ping -
# a slow local/reasoning model has to load, read the instruction, emit the call,
# and stop. Still bounded so a dead/throttled model aborts up front instead of
# burning the full per-issue executor_timeout. Override with MODEL_PREFLIGHT_TIMEOUT.
model_preflight_timeout="${MODEL_PREFLIGHT_TIMEOUT:-120}"
# Reviewer model. Same failure mode as the executor (free models go
# unresponsive); override with REVIEWER_MODEL.
reviewer_model="${REVIEWER_MODEL:-opencode/deepseek-v4-flash-free}"

timeout_bin=""
if command -v timeout >/dev/null 2>&1; then
  timeout_bin=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_bin=gtimeout
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
selected_issue_number=""
selected_issue_title=""
selected_issue_json=""
selected_issue_branch=""
selected_pr_number=""
selected_pr_url=""
selected_executor_log=""
executor_status=0
completed_or_skipped=""

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

resolve_opencode_repo() {
  local origin_url
  local repo_path

  if [[ -n "${OPENCODE_REPO:-}" ]]; then
    export OPENCODE_REPO
    return
  fi

  origin_url="$(git -C "$repo_root" remote get-url origin)"
  case "$origin_url" in
    git@github.com:*)
      repo_path="${origin_url#git@github.com:}"
      ;;
    https://github.com/*)
      repo_path="${origin_url#https://github.com/}"
      ;;
    ssh://git@github.com/*)
      repo_path="${origin_url#ssh://git@github.com/}"
      ;;
    *)
      fail "OPENCODE_REPO is required because origin is not a recognized GitHub URL: $origin_url"
      ;;
  esac

  repo_path="${repo_path%.git}"
  if ! [[ "$repo_path" =~ ^[^/]+/[^/]+$ ]]; then
    fail "Could not derive OPENCODE_REPO from origin: $origin_url"
  fi

  OPENCODE_REPO="$repo_path"
  export OPENCODE_REPO
}

on_error() {
  local exit_code=$?
  local branch

  trap - ERR
  printf '\nissue-loop.sh failed with exit code %d.\n' "$exit_code" >&2

  if git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch="$(git -C "$repo_root" branch --show-current 2>/dev/null || true)"
    printf 'Current branch: %s\n' "${branch:-unknown}" >&2
    printf 'Worktree status:\n' >&2
    git -C "$repo_root" status --short >&2 || true
    printf 'After resolving any in-progress changes, return to main with:\n' >&2
    printf '  git -C "%s" checkout main\n' "$repo_root" >&2
  fi

  exit "$exit_code"
}

trap on_error ERR

validate_preconditions() {
  if ! command -v "$opencode_bin" >/dev/null 2>&1; then
    fail "OpenCode binary not found: $opencode_bin"
  fi

  if ! command -v gh >/dev/null 2>&1; then
    fail 'GitHub CLI not found: gh'
  fi

  git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null

  if ! git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
    fail 'origin remote is required.'
  fi

  resolve_opencode_repo

  if ! git -C "$repo_root" show-ref --verify --quiet refs/heads/main; then
    fail 'Local main branch is required.'
  fi

  if ! git -C "$repo_root" rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
    fail 'Remote origin/main is required. Run: git fetch origin main'
  fi
}

ensure_clean_worktree() {
  local status
  status="$(git -C "$repo_root" status --short)"
  if [[ -n "$status" ]]; then
    printf 'Worktree must be clean before continuing:\n' >&2
    printf '%s\n' "$status" >&2
    exit 1
  fi
}

prepare_main() {
  printf '\n== Preparing main ==\n'
  git -C "$repo_root" status --short
  ensure_clean_worktree
  git -C "$repo_root" checkout main
  git -C "$repo_root" pull --ff-only origin main
}

ensure_review_branch() {
  local branch
  branch="$(git -C "$repo_root" branch --show-current)"

  if [[ -z "$branch" ]]; then
    fail '/issue-executor-pr left the repository in detached HEAD; refusing to run /review-branch.'
  fi

  if [[ "$branch" == "main" ]]; then
    fail '/issue-executor-pr completed on main; refusing to run /review-branch.'
  fi
}

ensure_issue_branch_has_commits() {
  local commit_count

  if [[ -n "$(git -C "$repo_root" status --short)" ]]; then
    fail '/issue-executor-pr left uncommitted changes; the executor must commit the completed fix before publication.'
  fi

  commit_count="$(git -C "$repo_root" rev-list --count origin/main..HEAD)"
  if [[ "$commit_count" == "0" ]]; then
    fail "/issue-executor-pr left no commits ahead of origin/main on ${selected_issue_branch}; the executor must complete and commit the fix before publication."
  fi
}

# Known dependency lockfiles across ecosystems (Python, JS, Rust, PHP, Ruby, Go).
# These are generated artifacts an executor edits indirectly (via a manifest) and
# routinely forgets to stage. ponytail: explicit allowlist, not a blanket *.lock -
# keeps an unrelated foo.lock from silently riding into the commit.
LOCKFILE_RE='(^|/)(uv\.lock|poetry\.lock|Pipfile\.lock|pdm\.lock|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|composer\.lock|Gemfile\.lock|go\.sum)$'

# Auto-heal: the executor often edits a manifest (pyproject.toml, package.json,
# ...) but forgets to stage the regenerated lockfile, leaving it dirty and tripping
# the commit gate. If the ONLY dirty paths are known lockfiles, fold them into
# HEAD so otherwise-complete work isn't rejected. Any other dirty path is left
# alone so ensure_issue_branch_has_commits still catches genuinely incomplete work.
reconcile_lockfiles() {
  local dirty
  dirty="$(git -C "$repo_root" status --porcelain)"
  [[ -n "$dirty" ]] || return 0
  # Only act when there's already a commit to amend onto this branch.
  [[ "$(git -C "$repo_root" rev-list --count origin/main..HEAD)" != "0" ]] || return 0
  # Every dirty path must be a known lockfile; otherwise leave the tree for the gate.
  if awk '{print $NF}' <<<"$dirty" | grep -qvE "$LOCKFILE_RE"; then
    return 0
  fi
  printf '\n== Reconciling unstaged lockfile(s) into the executor commit ==\n'
  # Safe: confirmed above that every dirty path is a lockfile.
  git -C "$repo_root" add -A
  git -C "$repo_root" commit --amend --no-edit
}

# No-op = executor made the branch but committed nothing and left a clean tree
# (issue obsolete / no changes needed). Uncommitted changes are NOT a no-op;
# that stays a hard failure via ensure_issue_branch_has_commits.
issue_branch_is_noop() {
  [[ -z "$(git -C "$repo_root" status --short)" ]] || return 1
  [[ "$(git -C "$repo_root" rev-list --count origin/main..HEAD)" == "0" ]]
}

comment_no_change_and_skip() {
  local reason
  # ponytail: grep || true so a no-match (exit 1) doesn't trip the ERR trap.
  reason="$(grep -a 'ISSUE_NOT_FIXED' "${selected_executor_log:-/dev/null}" | tail -n 1 || true)"
  if [[ -z "$reason" ]]; then
    reason='The automated issue-loop executor produced no changes for this issue.'
  fi
  gh issue comment \
    -R "$OPENCODE_REPO" \
    "$selected_issue_number" \
    --body "$(printf 'issue-loop: no changes were applied for this issue, so it is being skipped without review.\n\nExecutor signal:\n\n%s\n\nIf this issue is still valid, clarify the scope or reopen for manual work.' "$reason")"
}

comment_executor_failed_and_skip() {
  local detail
  if (( executor_status == 124 )); then
    detail="The executor exceeded its ${executor_timeout} time cap and was terminated (likely stuck in a loop)."
  else
    detail="The executor exited with status ${executor_status} before completing."
  fi
  gh issue comment \
    -R "$OPENCODE_REPO" \
    "$selected_issue_number" \
    --body "$(printf 'issue-loop: skipping this issue without review.\n\n%s\n\nNo PR was created. Re-run the loop or address this issue manually.' "$detail")"
}

# Discard whatever the executor left on the issue branch and return to a clean
# main. Used by every skip path so a half-finished or empty branch never blocks
# the next iteration. Safe because the issue branch is disposable here.
abandon_issue_branch() {
  git -C "$repo_root" reset --hard >/dev/null
  git -C "$repo_root" clean -fd >/dev/null
  git -C "$repo_root" checkout main
  git -C "$repo_root" branch -D "$selected_issue_branch" 2>/dev/null || true
  git -C "$repo_root" pull --ff-only origin main
}

write_pr_description() {
  local body_file="$1"
  local testing_block
  local unresolved_block
  local esc

  if [[ -n "${selected_executor_log:-}" && -s "${selected_executor_log:-}" ]]; then
    # Embed a bounded, ANSI-stripped tail of the executor run. ~~~ fences (not
    # backticks) keep this safe inside the expanded heredoc below; the value is
    # inserted literally and is not re-evaluated for substitutions.
    esc="$(printf '\033')"
    testing_block="$(
      printf '## Testing\n\nExecutor run output (tail, ANSI-stripped). Supplementary only - the reviewer still independently reruns the required verification before approval or merge.\n\n<details>\n<summary>issue-executor run output (last lines)</summary>\n\n~~~\n'
      tail -n 200 "$selected_executor_log" | sed "s/${esc}\[[0-9;]*[a-zA-Z]//g" | tail -c 8000
      printf '\n~~~\n\n</details>'
    )"
    unresolved_block="- None recorded by issue-loop before reviewer handoff."
  else
    testing_block='## Testing
- VERIFICATION OUTPUT NOT CAPTURED IN THIS BODY. The executor ran checks before committing, and the reviewer must independently rerun the required verification before approval or merge.'
    unresolved_block='- The wrapper could not capture the executor run output for this PR; rely on the reviewer rerun.'
  fi

  cat >"$body_file" <<EOF
## Summary
- Addresses #${selected_issue_number}: ${selected_issue_title}
- Implemented by the automated issue-loop executor on branch \`${selected_issue_branch}\`.

${testing_block}

## Risks
- Automated reviewer pass still needs to complete before merge consideration.

## Rollback
- Revert the commits from this PR.

## Unresolved Concerns
${unresolved_block}

Fixes #${selected_issue_number}
EOF
}

ensure_issue_pr() {
  local existing_pr_json
  local pr_body
  local body_file
  local remote_branch

  selected_pr_number=""
  selected_pr_url=""

  existing_pr_json="$(
    gh pr list \
      -R "$OPENCODE_REPO" \
      --head "$selected_issue_branch" \
      --state open \
      --json number,url,body \
      --jq '.[0] // empty'
  )"

  if [[ -z "$existing_pr_json" ]]; then
    if [[ -n "$(git -C "$repo_root" status --short)" ]]; then
      fail '/issue-executor-pr left uncommitted changes; refusing to create a PR from an incomplete branch.'
    fi

    remote_branch="$(git -C "$repo_root" ls-remote --heads origin "$selected_issue_branch")"
    if [[ -z "$remote_branch" ]]; then
      git -C "$repo_root" push -u origin "$selected_issue_branch"
    fi

    body_file="$(mktemp "${TMPDIR:-/tmp}/issue-loop-pr-body.XXXXXX")"
    write_pr_description "$body_file"
    gh pr create \
      -R "$OPENCODE_REPO" \
      --draft \
      --base main \
      --head "$selected_issue_branch" \
      --title "Fix #${selected_issue_number}: ${selected_issue_title}" \
      --body-file "$body_file"
    rm -f "$body_file"
  fi

  selected_pr_number="$(
    gh pr list \
      -R "$OPENCODE_REPO" \
      --head "$selected_issue_branch" \
      --state open \
      --json number \
      --jq '.[0].number // empty'
  )"
  selected_pr_url="$(
    gh pr list \
      -R "$OPENCODE_REPO" \
      --head "$selected_issue_branch" \
      --state open \
      --json url \
      --jq '.[0].url // empty'
  )"

  if [[ -z "$selected_pr_number" || -z "$selected_pr_url" ]]; then
    fail 'No open PR exists for the selected issue branch after PR creation step.'
  fi

  pr_body="$(
    gh pr view \
      -R "$OPENCODE_REPO" \
      "$selected_pr_number" \
      --json body \
      --jq '.body // ""'
  )"

  if [[ "$pr_body" != *"Fixes #${selected_issue_number}"* ]]; then
    body_file="$(mktemp "${TMPDIR:-/tmp}/issue-loop-pr-body.XXXXXX")"
    if [[ -z "$pr_body" ]]; then
      write_pr_description "$body_file"
    else
      printf '%s\n\nFixes #%s\n' "$pr_body" "$selected_issue_number" >"$body_file"
    fi
    gh pr edit \
      -R "$OPENCODE_REPO" \
      "$selected_pr_number" \
      --body-file "$body_file"
    rm -f "$body_file"
  fi

  printf 'Issue PR ready: %s\n' "$selected_pr_url"
}

issue_seen_this_run() {
  local issue_number="$1"

  [[ ",${completed_or_skipped}," == *",${issue_number},"* ]]
}

mark_completed_or_skipped() {
  local issue_number="$1"

  if ! issue_seen_this_run "$issue_number"; then
    if [[ -z "$completed_or_skipped" ]]; then
      completed_or_skipped="$issue_number"
    else
      completed_or_skipped="${completed_or_skipped},${issue_number}"
    fi
  fi
}

completed_or_skipped_csv() {
  if [[ -z "$completed_or_skipped" ]]; then
    printf 'none'
    return
  fi

  printf '%s' "$completed_or_skipped"
}

slugify_issue_title() {
  local raw_title="$1"
  local slug

  slug="$(
    printf '%s' "$raw_title" \
      | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
  )"
  if [[ -z "$slug" ]]; then
    slug="issue"
  fi

  printf '%s' "$slug"
}

candidate_has_remote_branch() {
  local issue_number="$1"
  local matching_branches

  matching_branches="$(git -C "$repo_root" ls-remote --heads origin "issue-fix/issue-${issue_number}-*")"
  [[ -n "$matching_branches" ]]
}

select_next_issue() {
  local issue_number
  local issue_title

  selected_issue_number=""
  selected_issue_title=""
  selected_issue_json=""
  selected_issue_branch=""

  printf '\n== Selecting next GitHub issue ==\n'
  while IFS=$'\t' read -r issue_number issue_title; do
    if [[ -z "${issue_number:-}" ]]; then
      continue
    fi

    if issue_seen_this_run "$issue_number"; then
      printf 'Skipping #%s: already completed or skipped in this loop run.\n' "$issue_number"
      continue
    fi

    gh issue view \
      -R "$OPENCODE_REPO" \
      "$issue_number" \
      --json number,title,state,url,closedByPullRequestsReferences,comments >/dev/null

    if candidate_has_remote_branch "$issue_number"; then
      printf 'Skipping #%s: matching issue-fix branch already exists.\n' "$issue_number"
      mark_completed_or_skipped "$issue_number"
      continue
    fi

    selected_issue_number="$issue_number"
    selected_issue_title="$issue_title"
    selected_issue_branch="issue-fix/issue-${issue_number}-$(slugify_issue_title "$issue_title")"
    selected_issue_json="$(
      gh issue view \
        -R "$OPENCODE_REPO" \
        "$issue_number" \
        --json number,title,state,url,body,labels,assignees,comments,closedByPullRequestsReferences
    )"
    printf 'Selected issue #%s: %s\n' "$selected_issue_number" "$selected_issue_title"
    return 0
  done < <(
    {
      # Priority pass: issues labeled "priority" preempt the normal queue,
      # oldest first. Falls through to the full open queue below.
      gh issue list \
        -R "$OPENCODE_REPO" \
        --state open \
        --label priority \
        --limit 200 \
        --search "sort:created-asc" \
        --json number,title \
        --jq '.[] | [.number, .title] | @tsv'
      gh issue list \
        -R "$OPENCODE_REPO" \
        --state open \
        --limit 200 \
        --search "sort:created-asc" \
        --json number,title \
        --jq '.[] | [.number, .title] | @tsv'
    } | awk -F'\t' '!seen[$1]++'
  )

  fail 'No selectable open issue found.'
}

checkout_selected_issue_branch() {
  if [[ -z "$selected_issue_branch" ]]; then
    fail 'No selected issue branch is available.'
  fi

  printf '\n== Creating issue branch: %s ==\n' "$selected_issue_branch"
  git -C "$repo_root" checkout -b "$selected_issue_branch"
}

run_issue_executor() {
  local handoff_prompt

  handoff_prompt="$(cat <<EOF
The issue-loop script selected the next issue before this handoff.

Selected issue: #${selected_issue_number} ${selected_issue_title}
Current branch: ${selected_issue_branch}
Completed or skipped in this loop run: $(completed_or_skipped_csv)

Work only on the selected issue. Do not choose a different issue unless the duplicate gate below proves this issue is no longer valid.
The issue-loop script has already created and checked out ${selected_issue_branch}. Do not create or check out a different branch.
Complete the implementation and verification in this run. Stage only the intended files.
Commit the completed fix on the current branch.
Do not push the branch or create a pull request. The issue-loop script owns push and draft PR creation after it verifies your commit.

MergeRisk project context:
- This repository is a Node 24 TypeScript GitHub Action for pull request merge-risk reports.
- Before editing, read README.md, 01-product-spec.md, docs/superpowers/plans/2026-06-29-mergerisk-action.md, and 02-agent-task-backlog.md.
- If the selected GitHub issue maps to an item in 02-agent-task-backlog.md, follow its acceptance criteria and implementation plan task number.
- Keep the MVP scope locked: bring-your-own model key, deterministic risk scoring, optional AI synthesis, one sticky PR comment, no SaaS backend.
- Use tests-first implementation for TypeScript behavior changes. At minimum, run the verification commands named by the selected issue or backlog item before committing.

Before editing, re-run the duplicate gate for #${selected_issue_number}:
1. gh issue view -R "\$OPENCODE_REPO" ${selected_issue_number} --json number,title,state,url,closedByPullRequestsReferences,comments
2. gh pr list -R "\$OPENCODE_REPO" --state all --limit 100 --search "#${selected_issue_number}" --json number,title,state,isDraft,url,headRefName,baseRefName,closingIssuesReferences
3. git ls-remote --heads origin "issue-fix/issue-${selected_issue_number}-*"

If the duplicate gate shows an open or merged PR already closes/references #${selected_issue_number}, or a matching issue-fix branch already exists, stop and say ISSUE_NOT_FIXED with the grounded reason.

Selected issue JSON:
${selected_issue_json}
EOF
)"

  # Capture the executor run (stdout+stderr) so its verification output can be
  # carried into the PR body. tee keeps the live terminal output intact.
  # Record the executor's exit status in executor_status instead of letting a
  # non-zero exit trip the ERR trap, so the caller can comment-and-skip rather
  # than killing the whole batch. timeout exits 124 when the cap is hit.
  selected_executor_log="$(mktemp "${TMPDIR:-/tmp}/issue-loop-executor.XXXXXX")"

  local -a executor_cmd=(
    "$opencode_bin" run
    --dir "$repo_root"
    --command issue-executor-pr
    --model "$executor_model"
    --variant high
    "$handoff_prompt"
  )
  if [[ -n "$timeout_bin" ]]; then
    executor_cmd=("$timeout_bin" "$executor_timeout" "${executor_cmd[@]}")
  else
    printf 'WARNING: no timeout(1)/gtimeout found; running executor without a time cap.\n' >&2
  fi

  # Run in an `if` test: a command in the if-condition is exempt from both
  # errexit and the ERR trap in every bash (macOS ships 3.2, where `set +e`
  # does NOT suppress the ERR trap and clobbers PIPESTATUS). PIPESTATUS still
  # reflects the pipeline, so we recover the executor's real exit code.
  if "${executor_cmd[@]}" 2>&1 | tee "$selected_executor_log"; then
    executor_status=0
  else
    executor_status="${PIPESTATUS[0]}"
  fi
}

# Fail fast if a model can't do the one thing the loop needs: drive tools. Run
# once up front so a model that can't tool-call (or a dead/throttled endpoint)
# aborts the whole run in ~1 min instead of no-op'ing every issue.
#
# A plain text ping ("reply PONG") is NOT enough: the observed failure mode is a
# model that streams a perfect *plan* - fenced shell, "Step 1..9" - but never
# emits a tool call, so it edits nothing and the loop sees an empty branch. That
# model passes a text ping. So the preflight demands a real side effect: write a
# sentinel file, in a throwaway --dir, via the model's file tool. We then check
# the file landed on disk. Narrating the write (no tool call) leaves the dir
# empty and fails here. The run log is kept OUTSIDE the work dir so the only file
# that can contain the token is one the model actually created.
# Args: <role label> <model> <override env var name>.
# ponytail: heuristic, not a sandbox - assumes opencode doesn't persist its own
# transcript into --dir (it stores sessions in its data dir, not the work dir).
preflight_model() {
  local role="$1"
  local model="$2"
  local override_var="$3"

  if [[ -z "$timeout_bin" ]]; then
    printf '\n== Skipping %s preflight (no timeout binary available) ==\n' "$role"
    return 0
  fi

  printf '\n== Preflight: %s model %s must complete a tool call (%ss cap) ==\n' \
    "$role" "$model" "$model_preflight_timeout"

  local work_dir out_file token prompt
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/issue-loop-preflight.XXXXXX")"
  out_file="$(mktemp "${TMPDIR:-/tmp}/issue-loop-preflight-log.XXXXXX")"
  token="OWT-PREFLIGHT-${RANDOM}${RANDOM}"
  prompt="Use your file-writing tool to create a file named preflight_ok.txt in the current working directory whose entire contents are exactly:
${token}
Do not print the contents in your reply - you must create the file with a tool call. Once the file exists, stop."

  # Run directly in the if-condition (not in $(...)). Command substitution
  # inherits the ERR trap under set -E, and bash 3.2 fires it from the subshell
  # on a 124 - a spurious failure banner. A bare command in an if-test is exempt.
  if "$timeout_bin" "$model_preflight_timeout" \
      "$opencode_bin" run --dir "$work_dir" --model "$model" "$prompt" \
      >"$out_file" 2>&1; then
    # Pass only if the token landed in a file under the work dir - proof of a
    # real write tool call, not a narrated plan. grep -r in an if-test is exempt
    # from the ERR trap on a no-match (exit 1).
    if grep -rqa "$token" "$work_dir"; then
      printf '%s model completed a tool call; continuing.\n' "$role"
      rm -rf "$work_dir" "$out_file"
      return 0
    fi
    rm -rf "$work_dir" "$out_file"
    fail "${role} model ${model} responded but never wrote the sentinel file via a tool call - it likely cannot drive tools in opencode (the no-op failure mode that leaves an empty branch). Set ${override_var} to a model that does agentic tool-calling and retry."
  fi

  rm -rf "$work_dir" "$out_file"
  fail "${role} model ${model} did not respond within ${model_preflight_timeout}s (likely down or throttled). Re-run with ${override_var} set to a working model."
}

validate_preconditions
# Check both models before any issue work so a dead endpoint aborts up front
# rather than after the executor has already done work the reviewer can't review.
preflight_model executor "$executor_model" EXECUTOR_MODEL
preflight_model reviewer "$reviewer_model" REVIEWER_MODEL

for ((issue_index = 1; issue_index <= issue_count; issue_index++)); do
  printf '\n== Issue %d/%d ==\n' "$issue_index" "$issue_count"
  prepare_main
  select_next_issue
  checkout_selected_issue_branch

  printf '\n== /issue-executor-pr: fix, verify, and commit on the selected branch ==\n'
  run_issue_executor
  mark_completed_or_skipped "$selected_issue_number"

  if (( executor_status != 0 )); then
    printf '\n== Executor failed (status %d); commenting on issue and skipping ==\n' "$executor_status"
    comment_executor_failed_and_skip
    abandon_issue_branch
    continue
  fi

  ensure_review_branch
  reconcile_lockfiles

  if issue_branch_is_noop; then
    printf '\n== Executor made no changes; commenting on issue and skipping review ==\n'
    comment_no_change_and_skip
    abandon_issue_branch
    continue
  fi

  ensure_issue_branch_has_commits
  ensure_issue_pr

  printf '\n== /review-branch: %s max ==\n' "$reviewer_model"
  "$opencode_bin" run \
    --dir "$repo_root" \
    --command review-branch \
    --model "$reviewer_model" \
    --variant max

  printf '\n== Returning to main ==\n'
  git -C "$repo_root" status --short
  ensure_clean_worktree
  git -C "$repo_root" checkout main
  git -C "$repo_root" pull --ff-only origin main
done

printf '\nProcessed %d issue(s).\n' "$issue_count"
