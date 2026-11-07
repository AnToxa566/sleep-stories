#!/usr/bin/env bash
# Google Cloud foundation for the API (slice 3.1): APIs, registry, service accounts,
# empty secrets, the Cloud Tasks queue and the IAM bindings between them.
# No Cloud Run service, no image, no Scheduler job (slices 3.2 and later).
#
# Safe to run again: each resource is created when absent and updated when present.
# It only ADDS IAM bindings and never removes one; a revoke is a manual
# `remove-iam-policy-binding` (infra/README.md). It never adds a secret version:
# only set-secret.sh does, with the value read from the terminal.
#
# Usage: DRY_RUN=1 bash infra/bootstrap.sh   (print the commands, run none)
#        bash infra/bootstrap.sh
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

preflight

# --- 1. APIs (one call; enabling an enabled API is a no-op) -----------------------
log "Enabling ${#APIS[@]} APIs"
gc services enable "${APIS[@]}"

# --- 2. Artifact Registry: a Docker repository that keeps the 2 latest images ------
# Vulnerability scanning is off (it bills per scanned image). The cleanup policy is a
# keep rule (the most recent versions) and a delete rule (anything older than a day);
# when an image matches both, it is kept. --no-dry-run is needed: without it the policy
# is only evaluated and nothing is ever deleted.
log "Artifact Registry repository ${AR_REPO} in ${REGION}"
if exists artifacts repositories describe "$AR_REPO" --location="$REGION"; then
  log "repository ${AR_REPO} exists: making sure vulnerability scanning is off"
  gc artifacts repositories update "$AR_REPO" --location="$REGION" --disable-vulnerability-scanning
else
  gc artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Sleep Stories API images" \
    --disable-vulnerability-scanning
fi
policy_file="$(mktemp)"
trap 'rm -f "$policy_file"' EXIT
cat >"$policy_file" <<JSON
[
  {
    "name": "keep-most-recent",
    "action": {"type": "Keep"},
    "mostRecentVersions": {"keepCount": ${AR_KEEP_COUNT}}
  },
  {
    "name": "delete-old",
    "action": {"type": "Delete"},
    "condition": {"tagState": "any", "olderThan": "${AR_DELETE_OLDER_THAN}"}
  }
]
JSON
if is_dry; then
  log "cleanup policy file that would be applied:"
  cat "$policy_file"
fi
gc artifacts repositories set-cleanup-policies "$AR_REPO" \
  --location="$REGION" --policy="$policy_file" --no-dry-run

# --- 3. Service accounts ----------------------------------------------------------
create_service_account() { # NAME EMAIL DISPLAY_NAME
  if exists iam service-accounts describe "$2"; then
    log "service account $1 exists"
  else
    log "creating service account $1"
    gc iam service-accounts create "$1" --display-name="$3"
  fi
}
create_service_account "$RUNTIME_SA_NAME" "$RUNTIME_SA_EMAIL" "Sleep Stories API runtime"
create_service_account "$INVOKER_SA_NAME" "$INVOKER_SA_EMAIL" "Signs OIDC tokens for Cloud Tasks and Scheduler"

# --- 4. Secrets: empty containers, replicated only in the one region ---------------
# No version is added here. DIRECT_URL is created but never granted to api-runtime.
for secret in "${ALL_SECRETS[@]}"; do
  if exists secrets describe "$secret"; then
    log "secret ${secret} exists"
  else
    log "creating secret ${secret} (empty)"
    gc secrets create "$secret" --replication-policy=user-managed --locations="$REGION"
  fi
done
for secret in "${RUNTIME_SECRETS[@]}"; do
  log "api-runtime may read ${secret}"
  gc_retry secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role=roles/secretmanager.secretAccessor \
    --condition=None --format=none
done

# --- 5. api-runtime may act as tasks-invoker (needed to name it in a task) ---------
log "api-runtime may act as tasks-invoker"
gc_retry iam service-accounts add-iam-policy-binding "$INVOKER_SA_EMAIL" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role=roles/iam.serviceAccountUser \
  --condition=None --format=none

# --- 6. Cloud Tasks queue ----------------------------------------------------------
# Explicit backoff: with the default one every 503 is retried at once and the
# attempts are gone in seconds (ARCHITECTURE.md section 12, bullet 4).
queue_flags=(
  --max-concurrent-dispatches="$QUEUE_MAX_CONCURRENT"
  --max-attempts="$QUEUE_MAX_ATTEMPTS"
  --min-backoff="$QUEUE_MIN_BACKOFF"
  --max-backoff="$QUEUE_MAX_BACKOFF"
  --max-dispatches-per-second="$QUEUE_MAX_PER_SECOND"
  --log-sampling-ratio="$QUEUE_LOG_SAMPLING"
)
if exists tasks queues describe "$QUEUE_NAME" --location="$REGION"; then
  log "queue ${QUEUE_NAME} exists: updating its settings"
  gc tasks queues update "$QUEUE_NAME" --location="$REGION" "${queue_flags[@]}"
else
  log "creating queue ${QUEUE_NAME}"
  gc tasks queues create "$QUEUE_NAME" --location="$REGION" "${queue_flags[@]}"
fi
log "api-runtime may enqueue to ${QUEUE_NAME} (on the queue, not the project)"
gc_retry tasks queues add-iam-policy-binding "$QUEUE_NAME" --location="$REGION" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role=roles/cloudtasks.enqueuer --format=none

# tasks-invoker gets no project role: Cloud Run is public, the app checks the token.

# --- RESULT: read back what exists; names, versions and PASS/FAIL only -------------
log "Reading the state back"
runtime_member="serviceAccount:${RUNTIME_SA_EMAIL}"
if is_dry; then
  enabled_apis=""
else
  enabled_apis="$(gc_read services list --enabled --format='value(config.name)')"
fi
for api in "${APIS[@]}"; do
  if is_dry; then result_add "api ${api}" SKIPPED "dry run"
  elif printf '%s\n' "$enabled_apis" | grep -Fxq "$api"; then result_add "api ${api}" PASS
  else result_add "api ${api}" FAIL "not enabled"
  fi
done
check_exists "registry ${AR_REPO}" artifacts repositories describe "$AR_REPO" --location="$REGION"
check_exists "service account ${RUNTIME_SA_NAME}" iam service-accounts describe "$RUNTIME_SA_EMAIL"
check_exists "service account ${INVOKER_SA_NAME}" iam service-accounts describe "$INVOKER_SA_EMAIL"
check_exists "queue ${QUEUE_NAME}" tasks queues describe "$QUEUE_NAME" --location="$REGION"
for secret in "${ALL_SECRETS[@]}"; do
  check_exists "secret ${secret}" secrets describe "$secret"
  if is_dry; then
    result_add "secret ${secret} versions" SKIPPED "dry run"
  else
    states="$(gc_read secrets versions list "$secret" --format='value(state)')"
    versions="$(printf '%s\n' "$states" | grep -ci '^enabled$' || true)"
    if [ "$versions" -eq 0 ]; then
      result_add "secret ${secret} versions" EMPTY "run: bash infra/set-secret.sh ${secret}"
    else
      result_add "secret ${secret} versions" PASS "${versions} enabled"
    fi
  fi
done
for secret in "${RUNTIME_SECRETS[@]}"; do
  check_binding "api-runtime reads ${secret}" roles/secretmanager.secretAccessor "$runtime_member" \
    secrets get-iam-policy "$secret"
done
for secret in "${MIGRATE_SECRETS[@]}"; do
  check_no_binding "api-runtime does NOT read ${secret}" roles/secretmanager.secretAccessor "$runtime_member" \
    secrets get-iam-policy "$secret"
done
check_binding "api-runtime acts as ${INVOKER_SA_NAME}" roles/iam.serviceAccountUser "$runtime_member" \
  iam service-accounts get-iam-policy "$INVOKER_SA_EMAIL"
check_binding "api-runtime enqueues to ${QUEUE_NAME}" roles/cloudtasks.enqueuer "$runtime_member" \
  tasks queues get-iam-policy "$QUEUE_NAME" --location="$REGION"
result_add "audience (INTERNAL_OIDC_AUDIENCE)" INFO "$(service_audience)"

result_print "bootstrap ${PROJECT_ID}"
