#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s [options] [issue-count]\n' "$(basename "$0")"
  printf '\n'
  printf 'Runs gated mode by default. Use --legacy or -l for the OpenCode workflow.\n'
  printf 'issue-count must be a positive integer and defaults to 1. APPROVER_LOGINS is DaNyNaNd.\n'
  printf '\nLegacy options:\n'
  printf '  -l, --legacy                  Use the OpenCode executor/reviewer workflow.\n'
  printf '  --opencode-bin PATH           Default: opencode\n'
  printf '  --executor-model MODEL        Default: opencode/north-mini-code-free\n'
  printf '  --reviewer-model MODEL        Default: opencode/deepseek-v4-flash-free\n'
  printf '  --executor-reasoning LEVEL    Default: high\n'
  printf '  --reviewer-reasoning LEVEL    Default: high\n'
  printf '  --executor-timeout DURATION   Default: 20m\n'
  printf '  --preflight-timeout SECONDS   Default: 120\n'
  printf '\nGated options:\n'
  printf '  --codex-bin PATH              Default: codex\n'
  printf '  --claude-bin PATH             Default: claude\n'
  printf '  --codex-model MODEL           Default: Codex configured model\n'
  printf '  --claude-model MODEL          Default: Claude configured model\n'
  printf '  --codex-reasoning LEVEL       Default: high\n'
  printf '  --claude-reasoning LEVEL      Default: high\n'
  printf '  --max-review-cycles COUNT     Default: 3\n'
  printf '  --worktree-root PATH          Default: %s/issue-loop-worktrees\n' "${TMPDIR:-/tmp}"
  printf 'Uses OPENCODE_REPO when set; otherwise derives owner/repo from the origin remote.\n'
}

issue_loop_mode="gated"
issue_count=""
while (( $# > 0 )); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -l|--legacy) issue_loop_mode="legacy" ;;
    --gated) issue_loop_mode="gated" ;;
    --opencode-bin|--executor-model|--reviewer-model|--executor-reasoning|--reviewer-reasoning|--executor-timeout|--preflight-timeout|--codex-bin|--claude-bin|--codex-model|--claude-model|--codex-reasoning|--claude-reasoning|--max-review-cycles|--worktree-root)
      [[ $# -ge 2 && -n "$2" ]] || { printf '%s requires a value.\n' "$1" >&2; exit 64; }
      case "$1" in
        --opencode-bin) cli_opencode_bin="$2" ;;
        --executor-model) cli_executor_model="$2" ;;
        --reviewer-model) cli_reviewer_model="$2" ;;
        --executor-reasoning) cli_executor_reasoning="$2" ;;
        --reviewer-reasoning) cli_reviewer_reasoning="$2" ;;
        --executor-timeout) cli_executor_timeout="$2" ;;
        --preflight-timeout) cli_preflight_timeout="$2" ;;
        --codex-bin) cli_codex_bin="$2" ;;
        --claude-bin) cli_claude_bin="$2" ;;
        --codex-model) cli_codex_model="$2" ;;
        --claude-model) cli_claude_model="$2" ;;
        --codex-reasoning) cli_codex_reasoning="$2" ;;
        --claude-reasoning) cli_claude_reasoning="$2" ;;
        --max-review-cycles) cli_review_cycles="$2" ;;
        --worktree-root) cli_worktree_root="$2" ;;
      esac
      shift
      ;;
    --*) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 64 ;;
    *)
      [[ -z "$issue_count" ]] || { printf 'Only one issue-count may be supplied.\n' >&2; usage >&2; exit 64; }
      issue_count="$1"
      ;;
  esac
  shift
done

issue_count="${issue_count:-1}"
if ! [[ "$issue_count" =~ ^[1-9][0-9]*$ ]]; then
  printf 'issue-count must be a positive integer; got: %s\n' "$issue_count" >&2
  usage >&2
  exit 64
fi

# System-wide command: repo_root is the git toplevel of the caller's cwd.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || { printf 'issue-loop must be run from inside a git repository.\n' >&2; exit 64; }

# Load repo-root .env (if present) so model/timeout overrides can live there
# instead of the caller's shell. set -a exports every assignment so the
# ${VAR:-default} reads below pick them up. Note: a value in .env overrides one
# already exported in the shell - to override for a single run, edit .env.
# ponytail: source the file directly; these values are simple KEY=VALUE pairs.
env_file="$repo_root/.env"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

opencode_bin="${cli_opencode_bin:-${OPENCODE_BIN:-opencode}}"
# Wall-clock cap per executor run so a runaway/looping executor (e.g. one
# repeating the same git log forever) is abandoned instead of hanging the
# whole batch. Default 20m; override with EXECUTOR_TIMEOUT (timeout(1) format,
# e.g. 1200s, 30m). macOS ships no `timeout`; fall back to coreutils gtimeout,
# else run unguarded with a warning.
executor_timeout="${cli_executor_timeout:-${EXECUTOR_TIMEOUT:-20m}}"
# Executor model. The default free model occasionally goes unresponsive
# (returns no tokens for the full timeout); override to a working model with
# EXECUTOR_MODEL, e.g. opencode/deepseek-v4-flash-free.
executor_model="${cli_executor_model:-${EXECUTOR_MODEL:-opencode/north-mini-code-free}}"
executor_reasoning="${cli_executor_reasoning:-${EXECUTOR_REASONING:-high}}"
# Preflight cap (seconds). The preflight makes the model complete a full tool
# call (write a sentinel file), so it needs more headroom than a one-token ping -
# a slow local/reasoning model has to load, read the instruction, emit the call,
# and stop. Still bounded so a dead/throttled model aborts up front instead of
# burning the full per-issue executor_timeout. Override with MODEL_PREFLIGHT_TIMEOUT.
model_preflight_timeout="${cli_preflight_timeout:-${MODEL_PREFLIGHT_TIMEOUT:-120}}"
# Reviewer model. Same failure mode as the executor (free models go
# unresponsive); override with REVIEWER_MODEL.
reviewer_model="${cli_reviewer_model:-${REVIEWER_MODEL:-opencode/deepseek-v4-flash-free}}"
reviewer_reasoning="${cli_reviewer_reasoning:-${REVIEWER_REASONING:-high}}"

# Gated mode is intentionally constrained to this approver until policy changes.
APPROVER_LOGINS="DaNyNaNd"
export APPROVER_LOGINS

timeout_bin=""
if command -v timeout >/dev/null 2>&1; then
  timeout_bin=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_bin=gtimeout
fi
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

# Legacy keeps its permissive contract: only an open dependency blocks; closed
# and missing references remain selectable. Gated mode uses its own fail-closed
# predicate below.
candidate_dependency_numbers() {
  local body="$1"
  printf '%s\n' "$body" \
    | grep -ioE '(depends[ -]on|blocked[ -]by):?[[:space:]#,0-9]*' \
    | grep -oE '[0-9]+' \
    | sort -un
}

candidate_first_open_dependency() {
  local issue_number="$1"
  local body="$2"
  local dep state
  while read -r dep; do
    [[ -n "$dep" && "$dep" != "$issue_number" ]] || continue
    state="$(gh issue view -R "$OPENCODE_REPO" "$dep" --json state --jq '.state' 2>/dev/null || true)"
    if [[ "$state" == "OPEN" ]]; then
      printf '%s' "$dep"
      return 0
    fi
  done < <(candidate_dependency_numbers "$body")
  return 1
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

    if candidate_has_remote_branch "$issue_number"; then
      printf 'Skipping #%s: matching issue-fix branch already exists.\n' "$issue_number"
      mark_completed_or_skipped "$issue_number"
      continue
    fi

    local candidate_body blocking_dep
    candidate_body="$(gh issue view -R "$OPENCODE_REPO" "$issue_number" --json body --jq '.body // ""')"
    blocking_dep="$(candidate_first_open_dependency "$issue_number" "$candidate_body" || true)"
    if [[ -n "$blocking_dep" ]]; then
      printf 'Skipping #%s: waiting on open dependency #%s (see "depends-on" in the issue body).\n' "$issue_number" "$blocking_dep"
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
  local repo_context=""
  local repo_context_file="$repo_root/.ai/issue-loop-context.md"

  if [[ -f "$repo_context_file" ]]; then
    repo_context="$(printf '\nRepo-specific context (%s):\n\n%s\n' "$repo_context_file" "$(cat "$repo_context_file")")"
  fi

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
${repo_context}

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
    --variant "$executor_reasoning"
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

gated_codex_bin="${cli_codex_bin:-${CODEX_BIN:-codex}}"
gated_claude_bin="${cli_claude_bin:-${CLAUDE_BIN:-claude}}"
gated_codex_model="${cli_codex_model:-${CODEX_MODEL:-}}"
gated_claude_model="${cli_claude_model:-${CLAUDE_MODEL:-}}"
gated_codex_reasoning="${cli_codex_reasoning:-${CODEX_REASONING_EFFORT:-high}}"
gated_claude_reasoning="${cli_claude_reasoning:-${CLAUDE_EFFORT:-high}}"
gated_review_cycles="${cli_review_cycles:-${ISSUE_LOOP_MAX_REVIEW_CYCLES:-3}}"
gated_worktree_root="${cli_worktree_root:-${ISSUE_LOOP_WORKTREE_ROOT:-${TMPDIR:-/tmp}/issue-loop-worktrees}}"

gated_fail() { printf 'gated issue-loop: %s\n' "$1" >&2; return 1; }

gated_dependency_numbers() {
  local body="$1"
  printf '%s\n' "$body" \
    | grep -ivE '(prerequisite|depends[ -]on|blocked[ -]by)[ -]*pr' \
    | grep -ioE '(depends[ -]on|blocked[ -]by):?[[:space:]#,0-9]*' \
    | grep -oE '#[0-9]+' \
    | tr -d '#' \
    | sort -un
}

gated_prerequisite_pr_numbers() {
  local body="$1"
  printf '%s\n' "$body" \
    | grep -iE '(prerequisite|depends[ -]on|blocked[ -]by)[ -]*pr' \
    | grep -oE '#[0-9]+' \
    | tr -d '#' \
    | sort -un
}

gated_issue_has_label() {
  local labels="$1" label="$2"
  printf '%s\n' "$labels" | grep -Fxq "$label"
}

gated_approval_is_valid() {
  local task_id="$1" comments login body sha scope
  [[ -n "${APPROVER_LOGINS:-}" ]] || { gated_fail 'APPROVER_LOGINS is required in gated mode.'; return; }
  comments="$(gh issue view -R "$OPENCODE_REPO" "$selected_issue_number" --json comments --jq '.comments[] | [.author.login, .body] | @tsv')"
  while IFS=$'\t' read -r login body; do
    body="$(printf '%b' "$body")"
    [[ ",${APPROVER_LOGINS}," == *",${login},"* ]] || continue
    printf '%s\n' "$body" | grep -Fxq '/approve-cl-plugin' || continue
    printf '%s\n' "$body" | grep -Fxq "task: ${task_id}" || continue
    scope="$(printf '%s\n' "$body" | sed -nE 's/^[[:space:]]*scope:[[:space:]]*(.+[^[:space:]])[[:space:]]*$/\1/p' | head -n1)"
    sha="$(printf '%s\n' "$body" | sed -nE 's/^[[:space:]]*authority-commit:[[:space:]]*([0-9a-f]{40})[[:space:]]*$/\1/p' | head -n1)"
    [[ -n "$scope" && -n "$sha" ]] || continue
    if git -C "$repo_root" merge-base --is-ancestor "$sha" origin/main; then return 0; fi
  done <<<"$comments"
  return 1
}

gated_dependency_is_satisfied() {
  local dep="$1" state merged
  state="$(gh issue view -R "$OPENCODE_REPO" "$dep" --json state --jq '.state' 2>/dev/null)" || return 1
  [[ "$state" == "CLOSED" ]] || return 1
  merged="$(gh issue view -R "$OPENCODE_REPO" "$dep" --json closedByPullRequestsReferences --jq '[.closedByPullRequestsReferences[]? | select(.mergedAt != null)] | length' 2>/dev/null)" || return 1
  [[ "$merged" =~ ^[1-9][0-9]*$ ]]
}

gated_dependencies_satisfied() {
  local body="$1" dep prerequisite_pr merged
  while read -r dep; do
    [[ -n "$dep" && "$dep" != "$selected_issue_number" ]] || continue
    gated_dependency_is_satisfied "$dep" || return 1
  done < <(gated_dependency_numbers "$body")
  while read -r prerequisite_pr; do
    [[ -n "$prerequisite_pr" ]] || continue
    merged="$(gh pr view -R "$OPENCODE_REPO" "$prerequisite_pr" --json state,mergedAt --jq 'if .state == "MERGED" and .mergedAt != null then "yes" else "no" end' 2>/dev/null)" || return 1
    [[ "$merged" == "yes" ]] || return 1
  done < <(gated_prerequisite_pr_numbers "$body")
}

gated_select_issue() {
  local number title json labels body task_id
  while IFS=$'\t' read -r number title; do
    json="$(gh issue view -R "$OPENCODE_REPO" "$number" --json number,title,body,labels,comments --jq '.')"
    labels="$(gh issue view -R "$OPENCODE_REPO" "$number" --json labels --jq '.labels[].name')"
    gated_issue_has_label "$labels" blocked && continue
    gated_issue_has_label "$labels" approval-required && continue
    body="$(gh issue view -R "$OPENCODE_REPO" "$number" --json body --jq '.body // ""')"
    selected_issue_number="$number"; selected_issue_title="$title"; selected_issue_json="$json"
    task_id="$(printf '%s\n' "$body" | grep -oE 'CL-PLUGIN-[0-9]+' | head -n1 || true)"
    [[ -n "$task_id" ]] || { printf 'Skipping #%s: no CL-PLUGIN task identifier.\n' "$number"; continue; }
    gated_dependencies_satisfied "$body" || { printf 'Skipping #%s: a declared prerequisite is not closed by a merged PR.\n' "$number"; continue; }
    gated_approval_is_valid "$task_id" || { printf 'Skipping #%s: no valid approval for %s.\n' "$number" "$task_id"; continue; }
    selected_issue_branch="cl-plugin/$(slugify_issue_title "$task_id")-$(slugify_issue_title "$title")"
    return 0
  done < <(gh issue list -R "$OPENCODE_REPO" --state open --label cl-plugin --label automation-ready --limit 200 --search 'sort:created-asc' --json number,title --jq '.[] | [.number,.title] | @tsv')
  gated_fail 'No selectable gated issue found.'
}

gated_create_or_resume_worktree() {
  gated_worktree="$gated_worktree_root/${OPENCODE_REPO//\//_}/issue-${selected_issue_number}"
  mkdir -p "$(dirname "$gated_worktree")"
  if [[ -d "$gated_worktree/.git" || -f "$gated_worktree/.git" ]]; then return 0; fi
  if git -C "$repo_root" ls-remote --exit-code --heads origin "$selected_issue_branch" >/dev/null 2>&1; then
    git -C "$repo_root" fetch origin "$selected_issue_branch"
    if git -C "$repo_root" show-ref --verify --quiet "refs/heads/${selected_issue_branch}"; then
      git -C "$repo_root" worktree add "$gated_worktree" "$selected_issue_branch"
    else
      git -C "$repo_root" worktree add -b "$selected_issue_branch" "$gated_worktree" "origin/${selected_issue_branch}"
    fi
  else
    git -C "$repo_root" worktree add -b "$selected_issue_branch" "$gated_worktree" origin/main
  fi
}

gated_run_codex() {
  local prompt="$1"
  local -a cmd=("$gated_codex_bin" exec -C "$gated_worktree" -s workspace-write -a never -c "model_reasoning_effort=\"${gated_codex_reasoning}\"")
  [[ -z "$gated_codex_model" ]] || cmd+=(-m "$gated_codex_model")
  "${cmd[@]}" "$prompt"
}

gated_review() {
  local head="$1" out="$2" prompt status_before status_after head_after
  prompt="Review commit ${head} against origin/main. You are read-only: do not edit files, commit, push, or invoke GitHub write commands. Return JSON only with reviewed_commit_sha, outcome (approved|changes_requested|blocked), blocking_findings, nonblocking_findings, commands_run, and residual_risks."
  local -a cmd=("$gated_claude_bin" -p --permission-mode plan --effort "$gated_claude_reasoning" --tools 'Read,Glob,Grep,Bash' --allowed-tools 'Read,Glob,Grep,Bash(git status *),Bash(git diff *),Bash(git log *),Bash(git show *),Bash(npm test *),Bash(pnpm test *)' --disallowed-tools 'Edit,Write,Bash(git commit *),Bash(git push *),Bash(gh pr *),Bash(gh issue *)' --output-format json --json-schema '{"type":"object","required":["reviewed_commit_sha","outcome","blocking_findings","nonblocking_findings","commands_run","residual_risks"]}')
  [[ -z "$gated_claude_model" ]] || cmd+=(--model "$gated_claude_model")
  status_before="$(git -C "$gated_worktree" status --porcelain)"
  (cd "$gated_worktree" && "${cmd[@]}" "$prompt") >"$out"
  status_after="$(git -C "$gated_worktree" status --porcelain)"
  head_after="$(git -C "$gated_worktree" rev-parse HEAD)"
  [[ "$status_after" == "$status_before" && "$head_after" == "$head" ]] || return 1
  grep -Eq "\"reviewed_commit_sha\"[[:space:]]*:[[:space:]]*\"${head}\"" "$out" || return 1
  grep -Eq '"outcome"[[:space:]]*:[[:space:]]*"(approved|changes_requested|blocked)"' "$out"
}

gated_review_is_approved() {
  local review="$1"
  grep -Eq '"outcome"[[:space:]]*:[[:space:]]*"approved"' "$review" \
    && grep -Eq '"blocking_findings"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' "$review"
}

gated_block() {
  local reason="$1"
  gh issue edit -R "$OPENCODE_REPO" "$selected_issue_number" --add-label blocked
  gh issue comment -R "$OPENCODE_REPO" "$selected_issue_number" --body "gated issue-loop blocked: ${reason}"
  [[ -z "$selected_pr_number" ]] || gh pr edit -R "$OPENCODE_REPO" "$selected_pr_number" --add-label blocked
}

gated_run() {
  # Never merge automatically. The controller only publishes and labels drafts.
  [[ "$gated_review_cycles" =~ ^[1-9][0-9]*$ ]] || gated_fail 'ISSUE_LOOP_MAX_REVIEW_CYCLES must be a positive integer.'
  command -v "$gated_codex_bin" >/dev/null || gated_fail "Codex binary not found: $gated_codex_bin"
  command -v "$gated_claude_bin" >/dev/null || gated_fail "Claude binary not found: $gated_claude_bin"
  validate_preconditions
  for ((issue_index=1; issue_index<=issue_count; issue_index++)); do
    selected_pr_number=""; gated_select_issue; gated_create_or_resume_worktree
    selected_pr_number="$(gh pr list -R "$OPENCODE_REPO" --head "$selected_issue_branch" --state open --json number --jq '.[0].number // empty')"
    if [[ -z "$selected_pr_number" ]]; then
      gated_run_codex "Implement selected issue #${selected_issue_number}. Read repository AGENTS.md, the selected issue JSON below, and its linked task record. Optional .ai files may be absent. Commit the implementation; do not push or create a PR.\n\n${selected_issue_json}"
      git -C "$gated_worktree" status --short | grep -q . && { gated_block 'Codex left uncommitted changes.'; continue; }
      [[ "$(git -C "$gated_worktree" rev-list --count origin/main..HEAD)" != "0" ]] || { gated_block 'Codex produced no commit ahead of origin/main.'; continue; }
      git -C "$gated_worktree" push -u origin "$selected_issue_branch"
      gh pr create -R "$OPENCODE_REPO" --draft --base main --head "$selected_issue_branch" --title "${selected_issue_title}" --body "Fixes #${selected_issue_number}"
      selected_pr_number="$(gh pr list -R "$OPENCODE_REPO" --head "$selected_issue_branch" --state open --json number --jq '.[0].number // empty')"
    fi
    local cycle head review
    for ((cycle=1; cycle<=gated_review_cycles; cycle++)); do
      mkdir -p "${gated_worktree_root}/logs"
      head="$(git -C "$gated_worktree" rev-parse HEAD)"; review="${gated_worktree_root}/logs/issue-${selected_issue_number}-review-${cycle}.json"
      if ! gated_review "$head" "$review"; then gated_block 'Claude review was malformed or did not review the current commit.'; break; fi
      if gated_review_is_approved "$review"; then
        if gh pr checks -R "$OPENCODE_REPO" "$selected_pr_number" --required; then
          gh pr edit -R "$OPENCODE_REPO" "$selected_pr_number" --add-label human-review-ready
          gh issue edit -R "$OPENCODE_REPO" "$selected_issue_number" --add-label human-review-ready
        else gated_block 'Required CI checks are not green.'; fi
        break
      fi
      local resolver_head
      resolver_head="$head"
      gated_run_codex "Resolve the blocking findings in ${review}. Commit the fixes and push nothing."
      git -C "$gated_worktree" status --short | grep -q . && { gated_block 'Codex resolver left uncommitted changes.'; break; }
      [[ "$(git -C "$gated_worktree" rev-parse HEAD)" != "$resolver_head" ]] || { gated_block 'Codex resolver did not create a new commit.'; break; }
      git -C "$gated_worktree" push origin "$selected_issue_branch"
      if (( cycle == gated_review_cycles )); then gated_block "Blocking findings remain after ${gated_review_cycles} review cycles."; fi
    done
  done
}

run_legacy() {
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

  printf '\n== /review-branch: %s %s ==\n' "$reviewer_model" "$reviewer_reasoning"
  "$opencode_bin" run \
    --dir "$repo_root" \
    --command review-branch \
    --model "$reviewer_model" \
    --variant "$reviewer_reasoning"

  printf '\n== Returning to main ==\n'
  git -C "$repo_root" status --short
  ensure_clean_worktree
  git -C "$repo_root" checkout main
  git -C "$repo_root" pull --ff-only origin main
done

printf '\nProcessed %d issue(s).\n' "$issue_count"
}

if [[ "$issue_loop_mode" == "legacy" ]]; then
  run_legacy
else
  gated_run
fi
