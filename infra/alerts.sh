#!/usr/bin/env bash
# Alerts and a budget (slice 3.3): one email channel, two log-match alert policies and one
# monthly budget with email notifications. Nothing here stops spending: the Google Cloud ceiling
# is --max-instances=1 (config.sh); provider spend is bounded only by the vendor limits (set by
# hand, infra/README.md step 2) and the 5-per-day allowance.
#
# The address is the owner's own. It comes from the environment (ALERT_EMAIL) or, when that is
# unset and the script runs in a terminal, from a prompt (which keeps it out of the shell
# history). The scripts never print it and never commit it, but it does appear in gcloud's
# argument list (visible in `ps` while gcloud runs) and in gcloud's own log file on this Mac
# (~/.config/gcloud/logs).
#   ALERT_EMAIL=<address> bash infra/alerts.sh      or      bash infra/alerts.sh   (prompts)
#   DRY_RUN=1 bash infra/alerts.sh        (prints the commands; a placeholder address is used)
#
# Safe to run again: the channel, the policies and the budget are found by display name and
# updated when they exist, created when they do not.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# The address is checked BEFORE any gcloud call. Under DRY_RUN the printed commands always
# carry a placeholder and there is no prompt.
email="${ALERT_EMAIL:-}"
if [ -z "$email" ] && ! is_dry; then
  if [ -t 0 ]; then
    IFS= read -r -p "Alert email address (your own; it is not printed again): " email
  else
    die "ALERT_EMAIL is not set and there is no terminal to ask; run: ALERT_EMAIL=<address> bash infra/alerts.sh"
  fi
fi
if [ -z "$email" ] && ! is_dry; then die "no address given"; fi
if [ -n "$email" ] && ! [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  die "the alert address is not a plausible email address"
fi
if is_dry; then email="$ALERT_EMAIL_PLACEHOLDER"; fi
log "alert email: set"

preflight

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# find_name DISPLAY_NAME <gcloud list args>: sets FOUND to the resource name whose display
# name is exactly DISPLAY_NAME (matched here, not by a gcloud filter), or to "" when there is
# none. It is called as a plain statement, never inside $( ): bash 3.2 turns `set -e` off in a
# command substitution, so a failing listing would look like "absent" and a re-run would
# create a duplicate. A failed listing stops the script here.
FOUND=""
find_name() {
  local display="$1" out
  shift
  FOUND=""
  if is_dry; then return 0; fi
  out="$(gc_read "$@" --format='value(displayName,name)')" ||
    die "could not list existing resources - gcloud failed, see above -; nothing was created or changed by this step"
  FOUND="$(printf '%s\n' "$out" | awk -F'\t' -v n="$display" '$1 == n && !seen { print $2; seen = 1 }')"
}

# --- 1. Email notification channel (found by display name; no verification step) ---------
log "Notification channel: ${ALERT_CHANNEL_NAME}"
find_name "$ALERT_CHANNEL_NAME" beta monitoring channels list
channel="$FOUND"
if is_dry; then
  channel="projects/${PROJECT_ID}/notificationChannels/CHANNEL_ID"
  gc beta monitoring channels create --type=email --display-name="$ALERT_CHANNEL_NAME" \
    --description="Alerts for the Sleep Stories API" \
    --channel-labels="email_address=${email}" --format=none
elif [ -z "$channel" ]; then
  log "creating the channel"
  channel="$(gc beta monitoring channels create --type=email --display-name="$ALERT_CHANNEL_NAME" \
    --description="Alerts for the Sleep Stories API" \
    --channel-labels="email_address=${email}" --format='value(name)')"
  if [ -z "$channel" ]; then die "the channel was created but gcloud did not report its name"; fi
else
  log "channel exists: making sure it points at the current address"
  current="$(gc_read beta monitoring channels describe "$channel" --format='value(labels.email_address)')"
  if [ "$current" != "$email" ]; then
    gc beta monitoring channels update "$channel" --update-channel-labels="email_address=${email}" --format=none
  fi
fi

# --- 2. Two log-match alert policies -----------------------------------------------------
# A log-based policy has exactly one condition and combiner OR; alertStrategy needs the
# notification rate limit and the auto-close period. The filters match textPayload OR
# jsonPayload.msg so they survive a later change of the logger. No log text is put in a
# notification: the documentation only says where to look.
policy_file() { # FILE DISPLAY_NAME CONDITION_NAME FILTER_JSON_STRING DOC
  cat >"$1" <<JSON
{
  "displayName": "$2",
  "documentation": {"content": "$5", "mimeType": "text/markdown"},
  "conditions": [
    {
      "displayName": "$3",
      "conditionMatchedLog": {"filter": "$4"}
    }
  ],
  "combiner": "OR",
  "alertStrategy": {
    "notificationRateLimit": {"period": "${ALERT_RATE_LIMIT}"},
    "autoClose": "${ALERT_AUTO_CLOSE}"
  },
  "notificationChannels": ["${channel}"],
  "enabled": true
}
JSON
}

# (a) The API could not put a job on the Cloud Tasks queue (the job stays pending until the
# sweep). The two lines are fixed text in apps/api; the first is the adapter's, the second the callers'.
enqueue_filter="resource.type=\\\"cloud_run_revision\\\" resource.labels.service_name=\\\"${SERVICE_NAME}\\\" (textPayload:\\\"${ALERT_ENQUEUE_LINE}\\\" OR jsonPayload.msg:\\\"${ALERT_ENQUEUE_LINE}\\\" OR textPayload:\\\"${ALERT_ENQUEUE_CALLER_LINE}\\\" OR jsonPayload.msg:\\\"${ALERT_ENQUEUE_CALLER_LINE}\\\")"
policy_file "$tmp/enqueue.json" "$ALERT_POLICY_ENQUEUE" "Enqueue failed" "$enqueue_filter" \
  "The API could not enqueue a generation job. Open Logs Explorer for the service ${SERVICE_NAME} and read the code in the line. See infra/README.md, When something fails."

# (b) A failed attempt of the Scheduler job. The sweep logs nothing itself, so this is its
# only failure signal. Cloud Scheduler logs an AttemptStarted and an AttemptFinished entry per
# attempt (its troubleshooting page). That a failed attempt is logged with severity ERROR is NOT
# confirmed by the docs I could read; README step 8 says how to test the filter in Logs Explorer.
sweep_filter="resource.type=\\\"cloud_scheduler_job\\\" resource.labels.job_id=\\\"${SCHEDULER_JOB}\\\" severity>=ERROR"
policy_file "$tmp/sweep.json" "$ALERT_POLICY_SWEEP" "Sweep attempt failed" "$sweep_filter" \
  "A Cloud Scheduler attempt of ${SCHEDULER_JOB} failed. Open the job in the Cloud Scheduler console and Logs Explorer."

if is_dry; then
  log "policy file that would be applied (enqueue):"
  cat "$tmp/enqueue.json"
  log "policy file that would be applied (sweep):"
  cat "$tmp/sweep.json"
fi
apply_policy() { # DISPLAY_NAME FILE
  local existing
  find_name "$1" monitoring policies list
  existing="$FOUND"
  if [ -n "$existing" ]; then
    log "policy '$1' exists: replacing it"
    gc monitoring policies update "$existing" --policy-from-file="$2" --format=none
  else
    log "creating policy '$1'"
    gc monitoring policies create --policy-from-file="$2" --format=none
  fi
}
apply_policy "$ALERT_POLICY_ENQUEUE" "$tmp/enqueue.json"
apply_policy "$ALERT_POLICY_SWEEP" "$tmp/sweep.json"

# --- 3. Budget: notifies at 50, 90 and 100 percent; it does NOT stop spending -------------
# The budget is scoped to this project (by number) and notifies the channel above, in
# addition to the billing account's own administrators (default recipients stay on).
if is_dry; then
  billing_account="000000-000000-000000"
else
  billing_account="$(gc_read billing projects describe "$PROJECT_ID" --format='value(billingAccountName)')"
  billing_account="${billing_account#billingAccounts/}"
  if [ -z "$billing_account" ]; then die "the project has no billing account"; fi
fi
budget_flags=(
  --billing-account="$billing_account"
  --budget-amount="$BUDGET_AMOUNT"
  --filter-projects="projects/$(project_number)"
  --notifications-rule-monitoring-notification-channels="$channel"
  --billing-project="$PROJECT_ID"
  --format=none
)
find_name "$BUDGET_DISPLAY_NAME" billing budgets list --billing-account="$billing_account" --billing-project="$PROJECT_ID"
budget="$FOUND"
if [ -n "$budget" ]; then
  log "budget exists: updating its amount, thresholds and channel"
  threshold_flags=(--clear-threshold-rules)
  for t in "${BUDGET_THRESHOLDS[@]}"; do threshold_flags+=(--add-threshold-rule="percent=${t}"); done
  gc billing budgets update "$budget" "${budget_flags[@]}" "${threshold_flags[@]}"
else
  log "creating the budget"
  threshold_flags=()
  for t in "${BUDGET_THRESHOLDS[@]}"; do threshold_flags+=(--threshold-rule="percent=${t}"); done
  gc billing budgets create --display-name="$BUDGET_DISPLAY_NAME" --calendar-period=month \
    "${budget_flags[@]}" "${threshold_flags[@]}"
fi

# --- RESULT: names and PASS/FAIL, never the address --------------------------------------
log "Reading the state back"
if is_dry; then
  result_add "channel ${ALERT_CHANNEL_NAME}" SKIPPED "dry run"
  result_add "policy ${ALERT_POLICY_ENQUEUE}" SKIPPED "dry run"
  result_add "policy ${ALERT_POLICY_SWEEP}" SKIPPED "dry run"
  result_add "budget ${BUDGET_DISPLAY_NAME}" SKIPPED "dry run"
else
  find_name "$ALERT_CHANNEL_NAME" beta monitoring channels list
  channel_now="$FOUND"
  if [ -n "$channel_now" ]; then result_add "channel ${ALERT_CHANNEL_NAME}" PASS; else result_add "channel ${ALERT_CHANNEL_NAME}" FAIL "not found"; fi
  for display in "$ALERT_POLICY_ENQUEUE" "$ALERT_POLICY_SWEEP"; do
    find_name "$display" monitoring policies list
    name="$FOUND"
    if [ -z "$name" ]; then result_add "policy ${display}" FAIL "not found"; continue; fi
    state="$(gc_read monitoring policies describe "$name" --format='value(enabled,notificationChannels)')"
    if [ -n "$channel_now" ] && grep -Fq "$channel_now" <<<"$state" && grep -qi '^true' <<<"$state"; then
      result_add "policy ${display}" PASS "enabled, notifies the channel"
    else
      result_add "policy ${display}" FAIL "disabled or not linked to the channel"
    fi
  done
  find_name "$BUDGET_DISPLAY_NAME" billing budgets list --billing-account="$billing_account" --billing-project="$PROJECT_ID"
  budget_now="$FOUND"
  if [ -z "$budget_now" ]; then
    result_add "budget ${BUDGET_DISPLAY_NAME}" FAIL "not found"
  else
    units="$(gc_read billing budgets describe "$budget_now" --billing-account="$billing_account" --billing-project="$PROJECT_ID" --format='value(amount.specifiedAmount.units)')"
    if [ "$units" = "${BUDGET_AMOUNT%%[!0-9]*}" ]; then
      result_add "budget ${BUDGET_DISPLAY_NAME}" PASS "amount ${BUDGET_AMOUNT}"
    else
      result_add "budget ${BUDGET_DISPLAY_NAME}" FAIL "amount differs from config.sh"
    fi
  fi
fi
result_add "alert email" INFO "set (not shown)"
result_add "reminder" INFO "a budget only notifies; --max-instances=${RUN_MAX_INSTANCES} is the Google Cloud ceiling; provider spend needs the vendor limits (step 2)"
result_print "alerts ${PROJECT_ID}"
