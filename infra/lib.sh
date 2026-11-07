# shellcheck shell=bash
# Helpers shared by the infra scripts. Sourced, never executed.
#
# Rules this file enforces:
# - Every gcloud call goes through `gc` (a change) or `gc_read` (a read), and both
#   add --project, because the default project on the owner's Mac is another one.
#   `infra/check.sh` fails on any other gcloud call outside this file.
# - DRY_RUN=1 prints each change command and runs nothing: no gcloud call at all. Any other
#   value than unset, 0 or 1 is refused at load time.
# - No function here prints a secret value, and none takes one as an argument.

_infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "${_infra_dir}/config.sh"

is_dry() { [ "${DRY_RUN:-0}" = "1" ]; }
log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# DRY_RUN is unset, 0 or 1. Anything else (true, yes, on, 2) would silently run for real,
# so it stops every script at load time, before a single command.
case "${DRY_RUN:-0}" in
  0 | 1) ;;
  *) die "DRY_RUN must be unset, 0 or 1 (got a different value); nothing was run" ;;
esac

# Runs a command, or under DRY_RUN prints it (shell-quoted, so it can be pasted).
run() {
  if is_dry; then
    printf 'DRY-RUN: '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# A gcloud call that may change state. Under DRY_RUN it only prints.
gc() { run gcloud "$@" --project="$PROJECT_ID"; }

# A gcloud call that only reads. Never reached under DRY_RUN.
gc_read() {
  if is_dry; then die "internal error: gc_read was called under DRY_RUN"; fi
  gcloud "$@" --project="$PROJECT_ID"
}

# gc with up to 5 attempts, for IAM bindings made right after a service account or a
# secret was created (IAM is eventually consistent and may say "does not exist").
gc_retry() {
  local attempt=1
  until gc "$@"; do
    if [ "$attempt" -ge 5 ]; then return 1; fi
    attempt=$((attempt + 1))
    log "retrying in 5 seconds (IAM may still be propagating)"
    sleep 5
  done
}

# exists <gcloud describe-style args>: 0 if the resource exists, 1 if gcloud says it
# is absent, a hard stop on any other error (no permission, wrong flag). Under
# DRY_RUN it answers "absent" without calling gcloud.
exists() {
  if is_dry; then return 1; fi
  local err rc=0
  err="$(gc_read "$@" 2>&1 >/dev/null)" || rc=$?
  if [ "$rc" -eq 0 ]; then return 0; fi
  if printf '%s' "$err" | grep -qiE 'NOT_FOUND|not found|does not exist'; then return 1; fi
  printf 'ERROR: could not check whether a resource exists:\n%s\n' "$(printf '%s' "$err" | head -n 3)" >&2
  exit 1
}

# has_binding ROLE MEMBER <get-iam-policy args>: 0 if the policy has that exact
# role/member pair. The policy is captured, never printed (it lists the owner's email).
has_binding() {
  local role="$1" member="$2" out
  shift 2
  out="$(gc_read "$@" --flatten='bindings[].members' --format='csv[no-heading](bindings.role,bindings.members)')" || return 2
  printf '%s\n' "$out" | grep -Fxq "${role},${member}"
}

# Prints the hint for a gcloud that does not run, then stops.
_gcloud_python_hint() {
  cat >&2 <<'H'
ERROR: gcloud does not start, or cannot load its commands.
The gcloud release 564 needs Python 3.10 or newer for some command groups (for example "run").
Find one and point gcloud at it, then run the script again:
  export CLOUDSDK_PYTHON="$(uv python find 3.12)"
The path is specific to the machine; do not put it in a file in the repository.
H
  exit 1
}

# Local only: gcloud starts and can load the "run" command group (the one that fails
# on a Python older than 3.10).
check_gcloud_loads() {
  if ! gcloud --version >/dev/null 2>&1 || ! gcloud run deploy --help >/dev/null 2>&1; then
    _gcloud_python_hint
  fi
  # Every other command group the scripts use (GCLOUD_PROBES in config.sh), asked with --help:
  # a local lookup, no API call. Standard input is /dev/null so a missing component (beta) cannot
  # open an install prompt; it fails and is named here, not half way through a script.
  local probe
  for probe in "${GCLOUD_PROBES[@]}"; do
    # shellcheck disable=SC2086 # the probe is a command path of several words
    if ! gcloud $probe --help </dev/null >/dev/null 2>&1; then
      case "$probe" in
        beta*) die "gcloud cannot run '${probe}'; install the beta component: gcloud components install beta" ;;
        *) die "gcloud cannot run '${probe}'; update it: gcloud components update" ;;
      esac
    fi
  done
}

# Checks that gcloud loads, an account is active, the project is reachable and
# billing is on. Sets PROJECT_NUMBER (a real run ignores any value from the
# environment). Under DRY_RUN it does nothing, because it would call gcloud.
preflight() {
  if is_dry; then
    log "DRY_RUN=1: nothing is executed, no gcloud call is made, no preflight"
    return 0
  fi
  check_gcloud_loads
  local account billing
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1)"
  if [ -z "$account" ]; then die "no active gcloud account; run: gcloud auth login"; fi
  log "gcloud runs; an account is active; project is ${PROJECT_ID}"
  PROJECT_NUMBER="$(gc_read projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)" ||
    die "project ${PROJECT_ID} is not reachable with the active account"
  billing="$(gc_read billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" ||
    die "cannot read the billing state of ${PROJECT_ID}"
  if [ "$(printf '%s' "$billing" | tr '[:upper:]' '[:lower:]')" != "true" ]; then
    die "billing is not enabled for ${PROJECT_ID}"
  fi
}

# Prints the project number (a real run: after preflight; DRY_RUN: from the
# environment, default 000000000000, so a dry run works offline).
project_number() {
  if is_dry; then
    printf '%s' "${PROJECT_NUMBER:-000000000000}"
    return 0
  fi
  if [ -z "${PROJECT_NUMBER:-}" ]; then
    PROJECT_NUMBER="$(gc_read projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  fi
  printf '%s' "$PROJECT_NUMBER"
}

# --- Names derived from config.sh and the project number (the one place for each) ---
registry_host() { printf '%s-docker.pkg.dev' "$REGION"; }

# The image without a tag: <region>-docker.pkg.dev/<project>/<repository>/<image>.
image_path() { printf '%s/%s/%s/%s' "$(registry_host)" "$PROJECT_ID" "$AR_REPO" "$IMAGE_NAME"; }

# The OIDC audience: the deterministic Cloud Run URL, no path, no trailing slash. Cloud Run
# docs: https://SERVICE_NAME-PROJECT_NUMBER.REGION.run.app (known before the first deploy).
# The same string goes to the Cloud Run env INTERNAL_OIDC_AUDIENCE, the Scheduler job, the
# Scheduler URI base and the smoke test; the API compares it with the token `aud` exactly.
service_audience() { printf 'https://%s-%s.%s.run.app' "$SERVICE_NAME" "$(project_number)" "$REGION"; }

# The Cloud Tasks service agent: it signs the task tokens as the OIDC account.
cloud_tasks_agent() { printf 'service-%s@gcp-sa-cloudtasks.iam.gserviceaccount.com' "$(project_number)"; }

# 0 if the tag exists in the registry (a metadata read), 1 if not (also when the image
# has never been pushed), a hard stop on any other error. Never called under DRY_RUN.
image_tag_exists() { # TAG
  local tag="$1" out rc=0
  out="$(gc_read artifacts docker tags list "$(image_path)" --format=json 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$out" | grep -qiE 'NOT_FOUND|not found|does not exist'; then return 1; fi
    printf 'ERROR: could not list the image tags:\n%s\n' "$(printf '%s' "$out" | head -n 3)" >&2
    exit 1
  fi
  grep -qE "(/|\")${tag}\"" <<<"$out"
}

# A UTC time N seconds ago, as an RFC 3339 string for a log filter (BSD and GNU date).
iso_utc_ago() { # SECONDS
  local t=$(($(date +%s) - $1))
  date -u -r "$t" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@${t}" +%Y-%m-%dT%H:%M:%SZ
}

# --- RESULT block: names, versions and PASS/FAIL, never values -------------------
RESULT_TEXT=""
RESULT_FAILED=0

result_add() { # LABEL STATUS [DETAIL]
  RESULT_TEXT="${RESULT_TEXT}  $1: $2${3:+ ($3)}"$'\n'
  if [ "$2" = "FAIL" ]; then RESULT_FAILED=1; fi
}

check_exists() { # LABEL <describe args>
  local label="$1"
  shift
  if is_dry; then result_add "$label" SKIPPED "dry run"
  elif exists "$@"; then result_add "$label" PASS
  else result_add "$label" FAIL "not found"
  fi
}

check_binding() { # LABEL ROLE MEMBER <get-iam-policy args>
  local label="$1" rc=0
  shift
  if is_dry; then result_add "$label" SKIPPED "dry run"; return 0; fi
  has_binding "$@" || rc=$?
  case "$rc" in
    0) result_add "$label" PASS ;;
    1) result_add "$label" FAIL "binding missing" ;;
    *) result_add "$label" FAIL "cannot read the policy" ;;
  esac
}

# A policy that cannot be read is a FAIL here too, never a PASS.
check_no_binding() { # LABEL ROLE MEMBER <get-iam-policy args>
  local label="$1" rc=0
  shift
  if is_dry; then result_add "$label" SKIPPED "dry run"; return 0; fi
  has_binding "$@" || rc=$?
  case "$rc" in
    0) result_add "$label" FAIL "binding must not exist" ;;
    1) result_add "$label" PASS ;;
    *) result_add "$label" FAIL "cannot read the policy" ;;
  esac
}

result_print() { # TITLE; exits 1 when something failed
  printf '\nRESULT: %s\n%s' "$1" "$RESULT_TEXT"
  if is_dry; then
    printf 'RESULT: DRY-RUN (nothing was executed)\n'
  elif [ "$RESULT_FAILED" -eq 0 ]; then
    printf 'RESULT: PASS\n'
  else
    printf 'RESULT: FAIL\n'
    exit 1
  fi
}
