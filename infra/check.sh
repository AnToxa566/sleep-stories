#!/usr/bin/env bash
# Offline check of the infra scripts: syntax, dry runs and text rules. It calls no
# gcloud and reads no secret. The patterns below use [x] brackets so that this file
# does not match its own rules.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source ./config.sh # names only (no side effects); the dry-run placeholder address comes from here

failed=0
fail() { printf 'FAIL: %s\n' "$1" >&2; failed=1; }
# Prints "file:line:text" matches of a pattern outside comment lines.
code_matches() { # PATTERN FILE...
  local pattern="$1"
  shift
  grep -nHE -- "$pattern" "$@" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true
}

scripts=(./*.sh)

for f in "${scripts[@]}"; do
  bash -n "$f" || fail "syntax error in $f"
done

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x "${scripts[@]}" || fail "shellcheck reported problems"
else
  echo "shellcheck: skipped (not installed)"
fi

# Dry runs: they must succeed and print only commands; set-secret must refuse a
# name that is not on its list.
DRY_RUN=1 bash ./bootstrap.sh >/dev/null || fail "DRY_RUN bootstrap.sh failed"
DRY_RUN=1 bash ./set-secret.sh DATABASE_URL >/dev/null || fail "DRY_RUN set-secret.sh failed"
if DRY_RUN=1 bash ./set-secret.sh NOT_ON_THE_LIST >/dev/null 2>&1; then
  fail "set-secret.sh accepted a name that is not on its list"
fi
# Slice 3.2 scripts: they must also run offline (default project number 000000000000), and
# refuse a missing tag or an unknown mode.
DRY_RUN=1 bash ./push-image.sh >/dev/null 2>&1 || fail "DRY_RUN push-image.sh failed"
DRY_RUN=1 bash ./deploy.sh 0123456789ab >/dev/null || fail "DRY_RUN deploy.sh failed"
DRY_RUN=1 bash ./smoke.sh basic >/dev/null || fail "DRY_RUN smoke.sh basic failed"
DRY_RUN=1 bash ./smoke.sh sweep >/dev/null || fail "DRY_RUN smoke.sh sweep failed"
# Stub gcloud for the tests below: it logs every call to $stub_log and answers only the
# preflight reads; every other call (list, describe, create, update) fails. A test runs a
# script against it and looks at the log.
stub_dir="$(mktemp -d)"
trap 'rm -rf "$stub_dir"' EXIT
stub_log="$stub_dir/calls.log"
cat >"$stub_dir/gcloud" <<'STUB'
#!/bin/sh
echo "$*" >>"$STUB_LOG"
case "$*" in
  --version*) echo "Google Cloud SDK stub"; exit 0 ;;
  *"beta "*--help*) if [ -n "$STUB_NO_BETA" ]; then exit 1; fi; exit 0 ;;
  *--help*) exit 0 ;;
  "auth list"*) echo stub-account; exit 0 ;;
  *"projects describe"*projectNumber*) echo 123456789012; exit 0 ;;
  *"billing projects describe"*billingEnabled*) echo True; exit 0 ;;
esac
echo "stub gcloud: this call fails on purpose" >&2
exit 1
STUB
chmod +x "$stub_dir/gcloud"
# Run the scripts under the oldest bash that matters (macOS ships 3.2.57, where `set -e` is
# off inside $( ) and a failing listing used to look like "nothing exists").
old_bash=/bin/bash
if [ ! -x "$old_bash" ]; then old_bash=bash; fi
with_stub() { env STUB_LOG="$stub_log" STUB_NO_BETA="" PATH="$stub_dir:$PATH" "$@"; }

# Slice 3.3: alerts.sh dry-runs with the placeholder address (the real one comes from the
# environment or a prompt). Without a plausible address a real run must stop BEFORE any
# gcloud call. No terminal is attached in these runs (</dev/null), so there is no prompt.
DRY_RUN=1 "$old_bash" ./alerts.sh >/dev/null || fail "DRY_RUN alerts.sh failed"
: >"$stub_log"
if with_stub env -u ALERT_EMAIL "$old_bash" ./alerts.sh </dev/null >/dev/null 2>&1; then fail "alerts.sh ran without ALERT_EMAIL"; fi
if with_stub env ALERT_EMAIL=not-an-address "$old_bash" ./alerts.sh </dev/null >/dev/null 2>&1; then fail "alerts.sh accepted a bad ALERT_EMAIL"; fi
if [ -s "$stub_log" ]; then fail "alerts.sh called gcloud before it checked the address"; fi

# A failing listing must stop alerts.sh. If it were read as "absent", a re-run would create a
# duplicate channel, policy or budget. The stub log must show a list call and no create/update.
: >"$stub_log"
if with_stub env ALERT_EMAIL="$ALERT_EMAIL_PLACEHOLDER" "$old_bash" ./alerts.sh </dev/null >/dev/null 2>&1; then
  fail "alerts.sh went on after a failing gcloud list"
fi
if ! grep -qE ' list( |$)' "$stub_log"; then fail "the failing-list test never reached a list call"; fi
if grep -v -- '--help' "$stub_log" | grep -qE '(^| )(create|update|delete)( |$)'; then fail "alerts.sh created or changed something after a failing gcloud list"; fi

# A missing component (beta) is named at the start: the run stops with the install hint, and
# no call after the --help probes (no projects describe, nothing else) was made.
: >"$stub_log"
out="$(env STUB_LOG="$stub_log" STUB_NO_BETA=1 PATH="$stub_dir:$PATH" ALERT_EMAIL="$ALERT_EMAIL_PLACEHOLDER" "$old_bash" ./alerts.sh </dev/null 2>&1)" && rc=0 || rc=$?
if [ "$rc" -eq 0 ] || ! grep -q 'components install beta' <<<"$out"; then fail "a missing beta component was not named at the start"; fi
if grep -v -- '--help' "$stub_log" | grep -qE 'projects describe|create|update|list'; then fail "calls were made after a failed component probe"; fi

# DRY_RUN must be unset, 0 or 1: "true" used to run for real. Every script must refuse it with
# the DRY_RUN message (so the refusal is the cause, not some other error) and call no gcloud.
: >"$stub_log"
invocations=("bootstrap.sh" "set-secret.sh DATABASE_URL" "push-image.sh" "deploy.sh 0123456789ab" "smoke.sh basic" "smoke.sh sweep" "alerts.sh")
for value in true yes on 2; do
  for inv in "${invocations[@]}"; do
    # shellcheck disable=SC2086 # the invocation is "script arg": word splitting is wanted
    out="$(with_stub env DRY_RUN="$value" ALERT_EMAIL="$ALERT_EMAIL_PLACEHOLDER" "$old_bash" ./$inv </dev/null 2>&1)" && rc=0 || rc=$?
    if [ "$rc" -eq 0 ] || ! grep -q 'DRY_RUN must be' <<<"$out"; then fail "${inv%% *} did not refuse DRY_RUN=$value"; fi
  done
done
if [ -s "$stub_log" ]; then fail "a script called gcloud with an invalid DRY_RUN"; fi
if DRY_RUN=1 bash ./deploy.sh >/dev/null 2>&1; then fail "deploy.sh ran without an image tag"; fi
if DRY_RUN=1 bash ./smoke.sh nonsense >/dev/null 2>&1; then fail "smoke.sh accepted an unknown mode"; fi

# 1. No shell tracing: it would print secret values.
hits="$(code_matches 'set[[:space:]]+[-+][a-zA-Z]*[x]|bash[[:space:]]+-[a-z]*[x]' "${scripts[@]}")"
if [ -n "$hits" ]; then fail "shell tracing is on:"$'\n'"$hits"; fi

# 2. Every gcloud call goes through the wrapper in lib.sh. Two checks, on every non-comment line:
#    A. the word is never in command position: line start, after ; & | ( { ! ` $( or a keyword
#       (if elif while until then else do time command exec builtin env eval xargs nohup run),
#       with or without quotes. B. Outside lib.sh the word may appear only on a message line
#       (log, die, printf, echo, result_add, optionally after "if ...; then"), which is text. lib.sh
#       may hold exactly the four call lines and the three hint lines listed below. check.sh is
#       checked by A only (it holds a stub and the self-test).
call_pattern='(^|[;&|({!`]|\$\(|(^|[[:space:]])(run|then|else|do|if|elif|while|until|time|command|exec|builtin|xargs|env|nohup|eval))[[:space:]]*["'"'"']?gclou[d](["'"'"'[:space:]]|$)'
message_line='^[^:]+:[0-9]+:[[:space:]]*((if|elif) [^;]*; then[[:space:]]+)?(log|die|printf|echo|result_add)[[:space:]]'
bare_gcloud_hits() { # FILE... : prints "file:line:text" of every bare use
  local f
  for f in "$@"; do
    code_matches "$call_pattern" "$f"
    if [ "$f" != ./check.sh ]; then
      grep -nHwE -- 'gclou[d]' "$f" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' | grep -vE "$message_line" || true
    fi
  done
}
lib_allowed='^[^:]+:[0-9]+:(gc\(\) \{ run gclou[d] "\$@" --project="\$PROJECT_ID"; \}|  gclou[d] "\$@" --project="\$PROJECT_ID"|  if ! gclou[d] --version >/dev/null 2>&1 \|\| ! gclou[d] run deploy --help >/dev/null 2>&1; then|    if ! gclou[d] \$probe --help </dev/null >/dev/null 2>&1; then|        beta\*\) die "gclou[d] cannot run '"'"'\$\{probe\}'"'"'; install the beta component: gclou[d] components install beta" ;;|        \*\) die "gclou[d] cannot run '"'"'\$\{probe\}'"'"'; update it: gclou[d] components update" ;;|  account="\$\(gclou[d] auth list --filter=status:ACTIVE --format=.value\(account\). 2>/dev/null \| head -n 1\)"|ERROR: gclou[d] does not start, or cannot load its commands\.|The gclou[d] release 564 needs Python 3\.10 or newer for some command groups \(for example "run"\)\.|Find one and point gclou[d] at it, then run the script again:)$'
hits="$(bare_gcloud_hits $(printf '%s\n' "${scripts[@]}" | grep -v '/lib.sh$'))"
if [ -n "$hits" ]; then fail "a bare gcloud use outside lib.sh:"$'\n'"$hits"; fi
hits="$(bare_gcloud_hits ./lib.sh | grep -vE "$lib_allowed" || true)"
if [ -n "$hits" ]; then fail "lib.sh uses gcloud outside its wrapper:"$'\n'"$hits"; fi

# The guard itself: each bypass form must be caught, each legitimate form must pass. The word
# is built from two pieces so that this file does not match its own rule.
g='gclou''d'
guard_dir="$(mktemp -d)"
for form in "if $g x; then :; fi" "elif $g x; then :" "while $g x; do :; done" "until $g x; do :; done" \
  "command $g x" "time $g x" "exec $g x" "\"$g\" x" "'$g' x" "\`$g x\`" "out=\$($g x)" "log y && $g x" \
  "env A=1 $g x" "  $g x" "g=$g" "cmd=\"$g\""; do
  printf '%s\n' "$form" >"$guard_dir/bad.sh"
  if [ -z "$(cd "$guard_dir" && bare_gcloud_hits ./bad.sh)" ]; then fail "the gcloud guard missed: $form"; fi
done
for form in 'gc services list' 'run gc x' "die \"run: $g auth login\"" "  log \"no $g call here\"" "# $g in a comment" \
  "elif [ \"\$c\" = N ]; then result_add \"\$l\" FAIL \"$g gave no token\""; do
  printf '%s\n' "$form" >"$guard_dir/ok.sh"
  hits="$(cd "$guard_dir" && bare_gcloud_hits ./ok.sh)"
  if [ -n "$hits" ]; then fail "the gcloud guard flagged a legitimate line: $form"; fi
done
rm -rf "$guard_dir"

# 3. Only set-secret.sh may add or read a secret version.
hits="$(code_matches 'versions[[:space:]]+(ad[d]|acces[s])' $(printf '%s\n' "${scripts[@]}" | grep -v '/set-secret.sh$'))"
if [ -n "$hits" ]; then fail "secret versions touched outside set-secret.sh:"$'\n'"$hits"; fi

# 4. A value flag is allowed only as the stdin form in set-secret.sh.
hits="$(grep -nH -- '[-][-]data' ./* | grep -v '[-][-]data-file=-' || true)"
if [ -n "$hits" ]; then fail "a --data flag other than --data-file=- :"$'\n'"$hits"; fi

# 5. No secret-looking literal anywhere in infra/.
hits="$(grep -nHEi -- 'sk-an[t]|sb_secre[t]_|ey[J]|postgre[s](ql)?://' ./* || true)"
if [ -n "$hits" ]; then fail "a secret-looking literal:"$'\n'"$hits"; fi

# 6. The identity token of your own account is read in one place (smoke.sh, owner_token) and
#    nowhere else.
hits="$(code_matches 'print-identity-toke[n]' "${scripts[@]}" |
  grep -vE '^\./smoke\.sh:[0-9]+:owner_token\(\) \{ gc_read auth print-identity-toke[n] 2>/dev/null; \}$' || true)"
if [ -n "$hits" ]; then fail "an identity token is read outside owner_token():"$'\n'"$hits"; fi

# 7. An Authorization header is never written as a literal: the one allowed form is a printf
#    format with %s, fed to curl on standard input.
approved="Authorizatio""n: Bearer %s\\n' \"\$token\""
hits="$(code_matches 'Authorizatio[n]:' "${scripts[@]}" | grep -vF "$approved" || true)"
if [ -n "$hits" ]; then fail "an Authorization header literal:"$'\n'"$hits"; fi

# 8. A token variable is never printed, logged or put in a message (except the approved
#    printf into curl above).
hits="$(code_matches '(echo|printf|log|die|result_add)[^|]*(\$\{?toke[n]|owner_toke[n])' "${scripts[@]}" |
  grep -vF "$approved" || true)"
if [ -n "$hits" ]; then fail "a token may be printed:"$'\n'"$hits"; fi

# 9. Docker: only `docker info` and `docker buildx build` (an arm64 image by plain `build`
#    would not start on Cloud Run); the Docker config file is only searched, never printed.
hits="$(code_matches 'docke[r][[:space:]]+(login|push|run|build|pull)([[:space:]]|$)' "${scripts[@]}")"
if [ -n "$hits" ]; then fail "a docker command other than info and buildx build:"$'\n'"$hits"; fi
hits="$(code_matches '\$docker_confi[g]' "${scripts[@]}" | grep -vF 'grep -Fq' || true)"
if [ -n "$hits" ]; then fail "the Docker config file is used for more than a search:"$'\n'"$hits"; fi

# 10. deploy.sh pins versions and never touches the migration secret.
hits="$(code_matches 'DIRECT_UR[L]|:lates[t]' ./deploy.sh)"
if [ -n "$hits" ]; then fail "deploy.sh names DIRECT_URL or a floating secret version:"$'\n'"$hits"; fi

# 11. No personal email address anywhere in infra/. Any address-looking text fails except an
#     explicit allow-list: the dry-run placeholder (config.sh), service-account addresses
#     (*.iam.gserviceaccount.com, including the service agents), and the documentation
#     placeholders such as <address>, which are not address-looking. No name is needed here.
email_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
placeholder_re="${ALERT_EMAIL_PLACEHOLDER//./\\.}"
email_hits() { # FILE... : "file:line:address" for each address that is not allowed
  grep -noHE -- "$email_re" "$@" |
    grep -vE ":(${placeholder_re}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*\.iam\.gserviceaccount\.com)$" || true
}
hits="$(email_hits ./*)"
if [ -n "$hits" ]; then fail "an email address in infra/ (not on the allow-list):"$'\n'"$hits"; fi
mail_dir="$(mktemp -d)"
printf '%s\n' "see $(printf '%s' 'someone''@example.org')" >"$mail_dir/bad.txt"
printf '%s\n' "tasks-invoker@sleep-stories-513914.iam.gserviceaccount.com service-%s@gcp-sa-cloudtasks.iam.gserviceaccount.com $ALERT_EMAIL_PLACEHOLDER <address>" >"$mail_dir/ok.txt"
if [ -z "$(email_hits "$mail_dir/bad.txt")" ]; then fail "the email guard missed a personal-looking address"; fi
if [ -n "$(email_hits "$mail_dir/ok.txt")" ]; then fail "the email guard flagged an allowed address"; fi
rm -rf "$mail_dir"

if [ "$failed" -ne 0 ]; then
  echo "infra check: FAILED" >&2
  exit 1
fi
echo "infra check: OK"
