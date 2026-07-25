#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
controller="$script_dir/issue-loop.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$1"; }

make_fixture() {
  local name="$1"
  fixture="$tmp/$name"
  mkdir -p "$fixture/bin" "$fixture/root" "$fixture/worktrees"
  : >"$fixture/events"
  printf '1\n' >"$fixture/head"
  printf '0\n' >"$fixture/claude-count"

  cat >"$fixture/bin/git" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'git %s\n' "$*" >>"$FIXTURE/events"
args=("$@")
if [[ "${args[0]:-}" == "-C" ]]; then args=("${args[@]:2}"); fi
case "${args[0]:-} ${args[1]:-} ${args[2]:-}" in
  'rev-parse --show-toplevel ') printf '%s\n' "$FIXTURE/root" ;;
  'rev-parse --is-inside-work-tree ') exit 0 ;;
  'remote get-url origin') printf 'git@github.com:onecode/test.git\n' ;;
  'show-ref --verify --quiet') exit 0 ;;
  'rev-parse --verify --quiet') printf '%040d\n' 1 ;;
  'merge-base --is-ancestor '*) [[ "${AUTH_ANCESTOR:-yes}" == yes ]] ;;
  'ls-remote --exit-code --heads') [[ "${RESUME:-no}" == yes ]] ;;
  'ls-remote --heads origin') [[ "${RESUME:-no}" == yes ]] && printf 'abc\trefs/heads/cl-plugin/x\n' ;;
  'fetch origin ') exit 0 ;;
  'worktree add '*)
    for ((i=0; i<${#args[@]}; i++)); do
      [[ "${args[$i]}" == "$FIXTURE"/* ]] && path="${args[$i]}" && break
    done
    mkdir -p "$path"; : >"$path/.git"
    ;;
  'status --short ') exit 0 ;;
  'push -u origin'|'push origin ')
    head="$(cat "$FIXTURE/head")"; printf '%s\n' "$((head + 1))" >"$FIXTURE/head"
    ;;
  'rev-parse HEAD ') printf '%040d\n' "$(cat "$FIXTURE/head")" ;;
  *) printf 'unexpected git: %s\n' "${args[*]}" >&2; exit 99 ;;
esac
EOF

  cat >"$fixture/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'gh %s\n' "$*" >>"$FIXTURE/events"
args_join=" $* "
has() { [[ "$args_join" == *" $1 "* ]]; }
if [[ "$1 $2" == 'issue list' ]]; then
  [[ "${SCENARIO:-success}" == success || "${SCENARIO:-success}" == resume || "${SCENARIO:-success}" == review-two || "${SCENARIO:-success}" == stale || "${SCENARIO:-success}" == exhausted || "${SCENARIO:-success}" == dep-missing || "${SCENARIO:-success}" == dep-open || "${SCENARIO:-success}" == dep-manual || "${SCENARIO:-success}" == dep-merged ]] && printf '47\tPlugin task\n'
  exit 0
fi
if [[ "$1 $2" == 'issue view' ]]; then
  num=''; for a in "$@"; do [[ "$a" =~ ^[0-9]+$ ]] && num="$a"; done
  if has labels; then
    case "${SCENARIO:-success}" in
      excluded-blocked) printf 'cl-plugin\nautomation-ready\nblocked\n' ;;
      excluded-approval) printf 'cl-plugin\nautomation-ready\napproval-required\n' ;;
      *) printf 'cl-plugin\nautomation-ready\n' ;;
    esac
  elif has body; then
    case "${SCENARIO:-success}" in
      dep-missing|dep-open|dep-manual|dep-merged) printf 'task: CL-PLUGIN-047\ndepends-on: #10\n' ;;
      *) printf 'task: CL-PLUGIN-047\n' ;;
    esac
  elif has comments; then
    case "${SCENARIO:-success}" in
      approval-unauthorized) printf 'mallory\t/approve-cl-plugin\\ntask: CL-PLUGIN-047\\nscope: x\\nauthority-commit: 0000000000000000000000000000000000000001\n' ;;
      approval-malformed) printf 'DaNyNaNd\t/approve-cl-plugin\\ntask: CL-PLUGIN-047\\nscope: \\nauthority-commit: short\n' ;;
      *) printf 'DaNyNaNd\t/approve-cl-plugin\\ntask: CL-PLUGIN-047\\nscope: tests\\nauthority-commit: 0000000000000000000000000000000000000001\n' ;;
    esac
  elif has state; then
    [[ "${SCENARIO:-success}" == dep-open ]] && printf 'OPEN\n' || printf 'CLOSED\n'
  elif has closedByPullRequestsReferences; then
    [[ "${SCENARIO:-success}" == dep-merged ]] && printf '1\n' || printf '0\n'
  else
    printf '{"number":47,"title":"Plugin task"}\n'
  fi
  exit 0
fi
if [[ "$1 $2" == 'pr list' ]]; then
  if [[ "${RESUME:-no}" == yes || -f "$FIXTURE/pr" ]]; then printf '12\n'; fi
  exit 0
fi
if [[ "$1 $2" == 'pr create' ]]; then : >"$FIXTURE/pr"; printf 'https://example.invalid/pr/12\n'; exit 0; fi
if [[ "$1 $2" == 'pr checks' ]]; then [[ "${CI_GREEN:-yes}" == yes ]]; exit; fi
if [[ "$1 $2" == 'pr edit' || "$1 $2" == 'issue edit' || "$1 $2" == 'issue comment' ]]; then exit 0; fi
printf 'unexpected gh: %s\n' "$*" >&2; exit 99
EOF

  cat >"$fixture/bin/codex" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'codex %s\n' "$*" >>"$FIXTURE/events"
exit 0
EOF

  cat >"$fixture/bin/claude" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'claude %s\n' "$*" >>"$FIXTURE/events"
count="$(cat "$FIXTURE/claude-count")"; count="$((count + 1))"; printf '%s\n' "$count" >"$FIXTURE/claude-count"
outcome="${CLAUDE_OUTCOMES:-approved}"; IFS=, read -r -a outcomes <<<"$outcome"; outcome="${outcomes[$((count-1))]:-${outcomes[${#outcomes[@]}-1]}"
prompt="${!#}"; sha="$(printf '%s' "$prompt" | grep -oE '[0-9a-f]{40}' | head -n1)"
[[ "$outcome" != stale ]] || sha=0000000000000000000000000000000000000099
[[ "$outcome" != changes_requested ]] || outcome=changes_requested
printf '{"reviewed_commit_sha":"%s","outcome":"%s","blocking_findings":[],"nonblocking_findings":[],"commands_run":["git diff"],"residual_risks":[]}\n' "$sha" "$outcome"
EOF
  chmod +x "$fixture/bin/"*
}

run_case() {
  local name="$1" expect="$2" scenario="$3" outcomes="$4" cycles="$5" resume="${6:-no}"
  make_fixture "$name"
  if PATH="$fixture/bin:$PATH" FIXTURE="$fixture" SCENARIO="$scenario" CLAUDE_OUTCOMES="$outcomes" ISSUE_LOOP_MODE=gated APPROVER_LOGINS=DaNyNaNd ISSUE_LOOP_MAX_REVIEW_CYCLES="$cycles" ISSUE_LOOP_WORKTREE_ROOT="$fixture/worktrees" RESUME="$resume" "$controller" 1 >"$fixture/out" 2>"$fixture/err"; then status=0; else status=$?; fi
  if ! { [[ "$expect" == success && "$status" == 0 ]] || [[ "$expect" == failure && "$status" != 0 ]]; }; then
    sed -n '1,240p' "$fixture/err" >&2
    sed -n '1,240p' "$fixture/events" >&2
    fail "$name exit status"
  fi
}

# Invalid mode must stop before the first fake command can execute.
make_fixture invalid
if PATH="$fixture/bin:$PATH" FIXTURE="$fixture" ISSUE_LOOP_MODE=invalid "$controller" 1 >"$fixture/out" 2>"$fixture/err"; then fail 'invalid mode accepted'; fi
[[ ! -s "$fixture/events" ]] || fail 'invalid mode changed state'
pass 'invalid mode fails before git or GitHub state'

for scenario in excluded-blocked excluded-approval approval-unauthorized approval-malformed dep-missing dep-open dep-manual; do
  run_case "$scenario" failure "$scenario" approved 3
  ! grep -q '^codex ' "$fixture/events" || fail "$scenario started Codex"
  pass "$scenario is rejected before implementation"
done

run_case dependency-merged success dep-merged approved 3
grep -q '^codex ' "$fixture/events" || fail 'merged dependency did not run Codex'
pass 'merged dependency permits implementation'

run_case one-review success success approved 3
grep -q 'gh pr create' "$fixture/events" || { cat "$fixture/events" >&2; fail 'draft PR not created'; }
grep -q 'gh pr checks' "$fixture/events" || { cat "$fixture/events" >&2; fail 'CI not checked'; }
grep -q 'human-review-ready' "$fixture/events" || { cat "$fixture/events" >&2; fail 'ready label missing'; }
pass 'successful current-HEAD review marks ready'

run_case second-cycle success review-two changes_requested,approved 3
[[ "$(grep -c '^claude ' "$fixture/events")" == 2 ]] || fail 'second review not run'
[[ "$(grep -c '^codex ' "$fixture/events")" == 2 ]] || fail 'resolver not run'
pass 'findings resolve and re-review on a second cycle'

run_case stale-review success stale stale 3
grep -q 'gated issue-loop blocked: Claude review was malformed' "$fixture/events" || fail 'stale review was accepted'
pass 'stale review SHA is rejected'

run_case cycle-exhaustion success exhausted changes_requested 1
grep -q 'Blocking findings remain after 1 review cycles' "$fixture/events" || fail 'cycle exhaustion not blocked'
pass 'review-cycle exhaustion blocks the issue'

run_case resume-existing success resume approved 3 yes
grep -q 'git -C .* worktree add .*cl-plugin' "$fixture/events" || fail 'existing PR was not resumed'
! grep -q 'worktree add -b' "$fixture/events" || fail 'resume created a replacement branch'
pass 'existing gated PR resumes from its branch'

! grep -Eq 'pr merge|reset --hard|clean -fd' "$fixture/events" || fail 'controller used forbidden destructive or merge command'
grep -q "$fixture/worktrees" "$fixture/events" || fail 'gated work did not use controller worktree'
! grep -q "codex .*${fixture}/root" "$fixture/events" || fail 'Codex used primary worktree'
pass 'no merge or destructive primary-worktree cleanup'
printf 'gated issue-loop controller tests passed\n'
