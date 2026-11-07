#!/usr/bin/env bash
# Deploys one image tag to Cloud Run and creates or updates the Scheduler sweep job
# (slice 3.2). The image must already be in the registry (infra/push-image.sh).
#
# Every deploy makes a NEW REVISION, and a new revision can cut a generation that is
# running (the lease and the sweep recover it; ARCHITECTURE.md section 12). Deploy when
# nothing is being generated.
#
# Safe to run again. Settings are SET, not merged (--set-env-vars, --set-secrets), so a
# value removed from config.sh is removed from the service on the next deploy.
# It only adds IAM bindings, never removes one.
#
# Usage: DRY_RUN=1 bash infra/deploy.sh <tag>   (prints the commands, runs none)
#        bash infra/deploy.sh <tag>
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

tag="${1:-}"
if ! [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  printf 'Usage: bash infra/deploy.sh <image tag>   (the tag push-image.sh printed)\n' >&2
  exit 1
fi

preflight
audience="$(service_audience)"
image="$(image_path):${tag}"
tasks_agent="serviceAccount:$(cloud_tasks_agent)"

# The API compares the email with INTERNAL_OIDC_SERVICE_ACCOUNT exactly, and Google writes
# service account emails in lower case.
if [ "$INVOKER_SA_EMAIL" != "$(printf '%s' "$INVOKER_SA_EMAIL" | tr '[:upper:]' '[:lower:]')" ]; then
  die "INVOKER_SA_EMAIL must be lower case"
fi

# --- 1. The image must exist -----------------------------------------------------
if is_dry; then
  log "DRY_RUN: not checking that ${image} exists"
elif image_tag_exists "$tag"; then
  log "image tag ${tag} is in the registry"
else
  die "image tag ${tag} is not in the registry; run: bash infra/push-image.sh (and use the tag it prints)"
fi

# --- 2. Cloud Tasks may sign tokens as tasks-invoker -------------------------------
# Google's "Create HTTP target tasks" page: the Cloud Tasks service agent needs
# roles/iam.serviceAccountUser on the OIDC account. The agent is created when the Cloud
# Tasks API is enabled; asking for the identity again is harmless and covers a delay.
log "Making sure the Cloud Tasks and Cloud Scheduler service agents exist"
for service in cloudtasks.googleapis.com cloudscheduler.googleapis.com; do
  gc beta services identity create --service="$service" --format=none ||
    log "could not create the ${service} service identity (it may exist already); continuing"
done
log "the Cloud Tasks service agent may act as ${INVOKER_SA_NAME}"
gc_retry iam service-accounts add-iam-policy-binding "$INVOKER_SA_EMAIL" \
  --member="$tasks_agent" \
  --role=roles/iam.serviceAccountUser \
  --condition=None --format=none ||
  die "could not grant the Cloud Tasks service agent its role on ${INVOKER_SA_NAME}; if the agent does not exist yet, run: gcloud beta services identity create --service=cloudtasks.googleapis.com --project=${PROJECT_ID} and try again"

# --- 3. Pin every runtime secret to its newest enabled version ---------------------
# A version number, not "latest": the service then starts the same on every cold start, and
# a rotation (a new version) takes effect only with a deploy. Costs: after set-secret.sh
# the service must be deployed again.
newest_enabled_version() { # NAME -> prints the number, or nothing
  gc_read secrets versions list "$1" --format='csv[no-heading](name.basename(),state)' |
    awk -F, 'tolower($2) == "enabled" && $1 ~ /^[0-9]+$/ { if ($1 + 0 > max) max = $1 + 0 } END { if (max > 0) print max }'
}
secret_pairs=()
pinned=""
for secret in "${RUNTIME_SECRETS[@]}"; do
  if is_dry; then
    version="NEWEST"
  else
    version="$(newest_enabled_version "$secret")" || version=""
    if [ -z "$version" ]; then
      die "secret ${secret} has no enabled version (or it could not be read; see above); run: bash infra/set-secret.sh ${secret}"
    fi
  fi
  secret_pairs+=("${secret}=${secret}:${version}")
  pinned="${pinned}${secret}:${version} "
done
secrets_flag="$(IFS=,; printf '%s' "${secret_pairs[*]}")"

# --- 4. Plain environment ------------------------------------------------------------
# The list separator is changed to "|" (gcloud's ^|^ syntax, "gcloud topic escaping"), so a
# value with a comma cannot split. No value may contain the new separator.
env_pairs=(
  "${RUN_ENV_VARS[@]}"
  "INTERNAL_OIDC_AUDIENCE=${audience}"
  "INTERNAL_OIDC_SERVICE_ACCOUNT=${INVOKER_SA_EMAIL}"
)
for pair in "${env_pairs[@]}"; do
  case "$pair" in
    *'|'*) die "an environment value contains '|', the list separator: ${pair%%=*}" ;;
  esac
done
env_flag="--set-env-vars=^|^$(IFS='|'; printf '%s' "${env_pairs[*]}")"

# --- 5. Deploy -------------------------------------------------------------------------
# --allow-unauthenticated: the service is public on purpose (owner, 2026-11-06); the app
# checks the Supabase JWT, and /internal/* checks the Google token. Request-based billing
# (--cpu-throttling) and no startup CPU boost: cold starts are accepted. The service
# account is api-runtime, which holds the secret, enqueue and act-as bindings.
log "REMINDER: this makes a new revision and can cut a generation that is running; deploy when nothing is being generated"
log "Deploying ${image} to ${SERVICE_NAME}"
gc run deploy "$SERVICE_NAME" \
  --region="$REGION" \
  --image="$image" \
  --service-account="$RUNTIME_SA_EMAIL" \
  --allow-unauthenticated \
  --port="$RUN_PORT" \
  --cpu="$RUN_CPU" \
  --memory="$RUN_MEMORY" \
  --concurrency="$RUN_CONCURRENCY" \
  --timeout="$RUN_TIMEOUT" \
  --min-instances="$RUN_MIN_INSTANCES" \
  --max-instances="$RUN_MAX_INSTANCES" \
  --cpu-throttling \
  --no-cpu-boost \
  "$env_flag" \
  "--set-secrets=${secrets_flag}"

# --- 6. The audience must be the URL Cloud Run reports ------------------------------
# The audience was computed before the service existed. If Cloud Run reports another URL,
# every Cloud Tasks and Scheduler call would be refused with 401, so stop loudly. The check
# reads only the URL fields (`"url"` lines and the urls annotation), not the env vars.
if ! is_dry; then
  described="$(gc_read run services describe "$SERVICE_NAME" --region="$REGION" --format=json)" ||
    die "could not read the deployed service"
  escaped="$(printf '%s' "$audience" | sed 's/[.]/\\./g')"
  if grep -qE "^[[:space:]]*\"url\": \"${escaped}\",?$" <<<"$described" ||
    grep -qE "run\\.googleapis\\.com/urls\".*${escaped}" <<<"$described"; then
    log "the service reports the audience URL"
  else
    reported="$(gc_read run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)')" || reported="?"
    die "the service URL is ${reported}, not ${audience}: INTERNAL_OIDC_AUDIENCE does not match it, so every internal call would get 401. Do not use this deployment; the URL format may have changed. The service is live and public but nothing is scheduled: tell the chat, do not run smoke"
  fi
fi

# --- 7. Scheduler sweep job --------------------------------------------------------------
# POST /api/internal/jobs/sweep every 10 minutes, signed as tasks-invoker for the audience.
# No retry (the next tick is the retry). The attempt deadline is above the Cloud Run
# timeout: the default 3 minutes is shorter than a sweep of many failed enqueues.
scheduler_flags=(
  --location="$REGION"
  --schedule="$SCHEDULER_CRON"
  --time-zone=Etc/UTC
  --uri="${audience}/api/internal/jobs/sweep"
  --http-method=POST
  --oidc-service-account-email="$INVOKER_SA_EMAIL"
  --oidc-token-audience="$audience"
  --attempt-deadline="$SCHEDULER_ATTEMPT_DEADLINE"
  --max-retry-attempts=0
  --description="Re-enqueues stuck generation jobs"
)
if exists scheduler jobs describe "$SCHEDULER_JOB" --location="$REGION"; then
  log "Scheduler job ${SCHEDULER_JOB} exists: updating it"
  gc scheduler jobs update http "$SCHEDULER_JOB" "${scheduler_flags[@]}"
else
  log "creating Scheduler job ${SCHEDULER_JOB}"
  gc scheduler jobs create http "$SCHEDULER_JOB" "${scheduler_flags[@]}"
fi

# --- RESULT: read back; names, versions and PASS/FAIL only -------------------------------
log "Reading the state back"
check_exists "service ${SERVICE_NAME}" run services describe "$SERVICE_NAME" --region="$REGION"
check_binding "service is public (run.invoker for allUsers)" roles/run.invoker allUsers \
  run services get-iam-policy "$SERVICE_NAME" --region="$REGION"
check_binding "Cloud Tasks agent acts as ${INVOKER_SA_NAME}" roles/iam.serviceAccountUser "$tasks_agent" \
  iam service-accounts get-iam-policy "$INVOKER_SA_EMAIL"
check_exists "scheduler job ${SCHEDULER_JOB}" scheduler jobs describe "$SCHEDULER_JOB" --location="$REGION"
if is_dry; then
  result_add "scheduler job settings" SKIPPED "dry run"
else
  job_json="$(gc_read scheduler jobs describe "$SCHEDULER_JOB" --location="$REGION" --format=json)" || job_json=""
  job_ok=1
  for expected in \
    "\"uri\": \"${audience}/api/internal/jobs/sweep\"" \
    "\"audience\": \"${audience}\"" \
    "\"serviceAccountEmail\": \"${INVOKER_SA_EMAIL}\"" \
    "\"schedule\": \"${SCHEDULER_CRON}\"" \
    "\"attemptDeadline\": \"${SCHEDULER_ATTEMPT_DEADLINE}\"" \
    '"state": "ENABLED"'; do
    grep -qF -- "$expected" <<<"$job_json" || job_ok=0
  done
  if [ "$job_ok" -eq 1 ]; then
    result_add "scheduler job settings (uri, audience, account, cron, deadline)" PASS
  else
    result_add "scheduler job settings (uri, audience, account, cron, deadline)" FAIL "differ from config.sh"
  fi
fi
result_add "image" INFO "$image"
result_add "secret versions pinned" INFO "$pinned"
result_add "audience (INTERNAL_OIDC_AUDIENCE)" INFO "$audience"
result_add "next" INFO "bash infra/smoke.sh basic"
result_print "deploy ${tag}"
