#!/usr/bin/env bash
# Live checks of the deployed API (slice 3.2). Run it after infra/deploy.sh.
#
#   bash infra/smoke.sh basic   health, the internal routes refuse bad credentials, and one
#                               real Cloud Task reaches /run with a valid token (HTTP 200)
#   bash infra/smoke.sh sweep   the Scheduler job runs the sweep, the sweep re-enqueues a
#                               test row you inserted (infra/README.md part 2, step 7), and
#                               the logs are clean of tokens, keys and emails
#
# A task with an unknown job id changes nothing: /run answers 200 {"status":"finished"}
# without writing a row (job-runner.service.ts, afterFailedClaim). It does cost a database
# read, which also proves that the database and its TLS work.
#
# Nothing here prints a token. The identity token of your own account is fed to curl on
# standard input (-H @-), never as an argument, so it is not in `ps`. Only counts and
# PASS or FAIL are printed from the logs.
#
# Usage: DRY_RUN=1 bash infra/smoke.sh basic   (prints the cloud commands, calls nothing)
#        SMOKE_SINCE=2026-11-07T10:00:00Z bash infra/smoke.sh sweep
#        (SMOKE_SINCE limits the "not enqueued" search to after a known-good deploy)
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

mode="${1:-}"
case "$mode" in
  basic | sweep) ;;
  *)
    printf 'Usage: bash infra/smoke.sh basic|sweep\n' >&2
    exit 1
    ;;
esac

preflight
audience="$(service_audience)"
run_path="/api/internal/jobs/run"
sweep_path="/api/internal/jobs/sweep"
poll_seconds=180

# --- HTTP probes ---------------------------------------------------------------------
# The identity token of the active gcloud account: valid for Google, but its audience and
# email are not the ones the API expects, so the API must refuse it. Prints the token on
# standard output for the caller's command substitution; it is never echoed or logged.
owner_token() { gc_read auth print-identity-token 2>/dev/null; }

# Prints the HTTP status. METHOD URL AUTH, AUTH is none, garbage or owner. The header goes
# to curl on standard input. A failed request is 000.
http_status() {
  local method="$1" url="$2" auth="$3" token="" code
  local body=(-H 'Content-Type: application/json' -d '{}')
  if [ "$method" = "GET" ]; then body=(); fi
  case "$auth" in
    garbage) token="this-is-not-a-token" ;;
    owner) token="$(owner_token)" || token="" ;;
  esac
  if [ "$auth" = "none" ]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 -X "$method" ${body[@]+"${body[@]}"} "$url" 2>/dev/null)" || code="000"
  elif [ -z "$token" ]; then
    code="NOTOKEN"
  else
    code="$(printf 'Authorization: Bearer %s\n' "$token" |
      curl -sS -o /dev/null -w '%{http_code}' --max-time 60 -X "$method" -H @- ${body[@]+"${body[@]}"} "$url" 2>/dev/null)" || code="000"
  fi
  token=""
  printf '%s' "$code"
}

expect_status() { # LABEL METHOD PATH AUTH EXPECTED
  local label="$1" method="$2" path="$3" auth="$4" expected="$5" code
  if is_dry; then
    printf 'DRY-RUN: curl -X %s %s%s (auth: %s)\n' "$method" "$audience" "$path" "$auth"
    result_add "$label" SKIPPED "dry run"
    return 0
  fi
  code="$(http_status "$method" "${audience}${path}" "$auth")"
  # A cold start can take longer than one request allows: the health check gets 3 tries.
  if [ "$code" != "$expected" ] && [ "$method" = "GET" ]; then
    for _ in 1 2; do
      sleep 5
      code="$(http_status "$method" "${audience}${path}" "$auth")"
      if [ "$code" = "$expected" ]; then break; fi
    done
  fi
  if [ "$code" = "$expected" ]; then result_add "$label" PASS "HTTP ${code}"
  elif [ "$code" = "NOTOKEN" ]; then result_add "$label" FAIL "gcloud gave no identity token; this probe is part of the proof; fix with: gcloud auth login"
  else result_add "$label" FAIL "HTTP ${code}, expected ${expected}"
  fi
}

# --- Cloud Logging probes ---------------------------------------------------------------
service_filter="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\""
# Request log entries (Cloud Run writes one per request). A POST to PATH with STATUS since T.
request_filter() { # PATH STATUS SINCE [USER_AGENT_PART]
  local agent=""
  if [ -n "${4:-}" ]; then agent=" AND httpRequest.userAgent:\"$4\""; fi
  printf '%s AND logName="projects/%s/logs/run.googleapis.com%%2Frequests" AND httpRequest.requestMethod="POST" AND httpRequest.requestUrl:"%s" AND httpRequest.status=%s AND timestamp>="%s"%s' \
    "$service_filter" "$PROJECT_ID" "$1" "$2" "$3" "$agent"
}
# Text lines the app wrote (stdout and stderr).
text_filter() { # EXTRA SINCE
  printf '%s AND (logName="projects/%s/logs/run.googleapis.com%%2Fstdout" OR logName="projects/%s/logs/run.googleapis.com%%2Fstderr") AND %s AND timestamp>="%s"' \
    "$service_filter" "$PROJECT_ID" "$PROJECT_ID" "$1" "$2"
}

# Number of matching entries (at most 100); prints "ERR" when the log cannot be read.
log_count() { # FILTER
  local out
  out="$(gc_read logging read "$1" --freshness=1d --limit=100 --order=desc --format='value(timestamp)' 2>/dev/null)" || {
    printf 'ERR'
    return 0
  }
  if [ -z "$out" ]; then printf '0'; else printf '%s\n' "$out" | grep -c .; fi
}

# PASS as soon as one entry matches; FAIL after poll_seconds. Request logs lag a little.
wait_for_log() { # LABEL FILTER
  local label="$1" filter="$2" waited=0 count
  if is_dry; then
    gc logging read "$filter" --freshness=1d --limit=1 --order=desc --format='value(timestamp)'
    result_add "$label" SKIPPED "dry run"
    return 0
  fi
  while :; do
    count="$(log_count "$filter")"
    if [ "$count" = "ERR" ]; then result_add "$label" FAIL "the log could not be read"; return 0; fi
    if [ "$count" != "0" ]; then result_add "$label" PASS; return 0; fi
    if [ "$waited" -ge "$poll_seconds" ]; then
      result_add "$label" FAIL "no matching log entry within ${poll_seconds}s"
      return 0
    fi
    sleep 10
    waited=$((waited + 10))
  done
}

# PASS when nothing matches.
expect_no_log() { # LABEL FILTER
  local count
  if is_dry; then
    gc logging read "$2" --freshness=1d --limit=100 --order=desc --format='value(timestamp)'
    result_add "$1" SKIPPED "dry run"
    return 0
  fi
  count="$(log_count "$2")"
  if [ "$count" = "0" ]; then result_add "$1" PASS "0 lines"
  elif [ "$count" = "ERR" ]; then result_add "$1" FAIL "the log could not be read"
  else result_add "$1" FAIL "${count} line(s); look at them in Logs Explorer"
  fi
}

# ===== basic ===================================================================================
if [ "$mode" = "basic" ]; then
  expect_status "GET /api is up" GET /api none 200
  for path in "$run_path" "$sweep_path"; do
    expect_status "POST ${path#/api/internal/jobs/} without a token is refused" POST "$path" none 401
    expect_status "POST ${path#/api/internal/jobs/} with a made-up bearer is refused" POST "$path" garbage 401
    expect_status "POST ${path#/api/internal/jobs/} with your own Google token is refused" POST "$path" owner 401
  done

  # One real Cloud Task, signed by Cloud Tasks as tasks-invoker for the audience. The job id
  # is a random uuid that exists nowhere, so the run changes nothing. The start time has a
  # minute of margin for clock differences; the refused probes above are 401, never 200.
  started="$(iso_utc_ago 60)"
  probe_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  log "Creating one Cloud Task on ${QUEUE_NAME}"
  if gc tasks create-http-task \
    --queue="$QUEUE_NAME" \
    --location="$REGION" \
    --url="${audience}${run_path}" \
    --method=POST \
    --header=Content-Type:application/json \
    --body-content="{\"jobId\":\"${probe_id}\"}" \
    --oidc-service-account-email="$INVOKER_SA_EMAIL" \
    --oidc-token-audience="$audience" \
    --format=none; then
    log "Waiting up to ${poll_seconds} s for the request log to show a 200 on /run"
    wait_for_log "a Cloud Task reached /run with a valid token (HTTP 200)" "$(request_filter "$run_path" 200 "$started" "Google-Cloud-Tasks")"
  else
    result_add "a Cloud Task reached /run with a valid token (HTTP 200)" FAIL "the task could not be created"
  fi
fi

# ===== sweep ===================================================================================
if [ "$mode" = "sweep" ]; then
  # The window starts 5 seconds before the job is started (for a clock difference), not a
  # minute back: an earlier `basic` run must not satisfy the checks of this one. The /run
  # check is limited to requests from Cloud Tasks (its default User-Agent contains
  # "Google-Cloud-Tasks", Cloud Tasks REST reference) and to after the Scheduler job ran. It
  # still cannot tell the test row from another job that was pending at the same moment.
  started="$(iso_utc_ago 5)"
  log "Running the Scheduler job ${SCHEDULER_JOB} now"
  if gc scheduler jobs run "$SCHEDULER_JOB" --location="$REGION"; then
    wait_for_log "the sweep was called with a valid token (HTTP 200)" "$(request_filter "$sweep_path" 200 "$started")"
    wait_for_log "a Cloud Tasks call to /run (HTTP 200) came after the sweep started" "$(request_filter "$run_path" 200 "$started" "Google-Cloud-Tasks")"
    wait_for_log "the test row failed for good (its payload is empty on purpose)" \
      "$(text_filter 'textPayload:"A job failed for good"' "$started")"
  else
    result_add "the Scheduler job ran" FAIL "gcloud could not run the job"
  fi

  # The line SECURITY.md/ARCHITECTURE.md section 12 alerts on. Since SMOKE_SINCE, or a day.
  since="${SMOKE_SINCE:-$(iso_utc_ago 86400)}"
  if ! [[ "$since" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    die "SMOKE_SINCE must look like 2026-11-07T10:00:00Z"
  fi
  expect_no_log "no 'the job was not enqueued' line since ${since}" \
    "$(text_filter 'textPayload:"the job was not enqueued"' "$since")"

  # Log hygiene over the last hour: nothing that looks like a token, a key or an email. The scan
  # reads textPayload only (the API logs plain text), while the alert filters in alerts.sh also
  # cover jsonPayload.msg, so a later move to JSON logs must extend these filters too.
  # The patterns are split so that infra/check.sh, which forbids secret-looking text in
  # this folder, does not match this file. Only counts are printed.
  hour="$(iso_utc_ago 3600)"
  jwt_start='ey''J'
  anthropic_start='sk-''ant'
  supabase_start='sb_''secret_'
  email_regex='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\\.[A-Za-z]{2,}'
  expect_no_log "no 'Bearer ' in the last hour of logs" "$(text_filter 'textPayload:"Bearer "' "$hour")"
  expect_no_log "no JWT-looking text in the last hour of logs" "$(text_filter "textPayload:\"${jwt_start}\"" "$hour")"
  expect_no_log "no Anthropic key in the last hour of logs" "$(text_filter "textPayload:\"${anthropic_start}\"" "$hour")"
  expect_no_log "no Supabase secret key in the last hour of logs" "$(text_filter "textPayload:\"${supabase_start}\"" "$hour")"
  expect_no_log "no email address in the last hour of logs" "$(text_filter "textPayload=~\"${email_regex}\"" "$hour")"

  printf '\nDelete the test row now (Supabase SQL editor):\n'
  printf "  delete from generation_jobs where dedupe_key like 'smoke:%%';\n"
fi

result_print "smoke ${mode} ${PROJECT_ID}"
