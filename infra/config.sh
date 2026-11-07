# shellcheck shell=bash
# Single source of names and numbers for the Google Cloud scripts in infra/.
# Sourced by lib.sh; it has no side effects and holds no secret
# (ARCHITECTURE.md section 12; SECURITY.md rule 1).

PROJECT_ID="sleep-stories-513914"
REGION="europe-west1"

# Names (slice 3.2 uses the Cloud Run, image and Scheduler names).
SERVICE_NAME="sleep-stories-api"
AR_REPO="api"
IMAGE_NAME="api"
QUEUE_NAME="generation-jobs"
SCHEDULER_JOB="jobs-sweep"
SCHEDULER_CRON='*/10 * * * *'
# Cloud Scheduler allows 15 s to 30 min for an HTTP target. 660 s is the Cloud Run
# timeout (600 s) plus one minute, the same margin as the Cloud Tasks dispatch deadline.
SCHEDULER_ATTEMPT_DEADLINE="660s"

# Service accounts. api-runtime runs Cloud Run; tasks-invoker only signs the OIDC
# tokens of Cloud Tasks and Cloud Scheduler (INTERNAL_OIDC_SERVICE_ACCOUNT).
RUNTIME_SA_NAME="api-runtime"
INVOKER_SA_NAME="tasks-invoker"
RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA_EMAIL="${INVOKER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Secrets. DIRECT_URL is for migrations only: api-runtime is never granted it.
RUNTIME_SECRETS=(DATABASE_URL SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY ELEVENLABS_API_KEY)
MIGRATE_SECRETS=(DIRECT_URL)
ALL_SECRETS=("${RUNTIME_SECRETS[@]}" "${MIGRATE_SECRETS[@]}")

APIS=(
  run.googleapis.com
  cloudtasks.googleapis.com
  cloudscheduler.googleapis.com
  artifactregistry.googleapis.com
  secretmanager.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  sts.googleapis.com
  monitoring.googleapis.com
  logging.googleapis.com
  billingbudgets.googleapis.com
)

# Artifact Registry keeps this many most recent images; older ones go after 1 day.
AR_KEEP_COUNT=2
AR_DELETE_OLDER_THAN="1d"

# Cloud Tasks queue (ARCHITECTURE.md section 12, bullet 4).
QUEUE_MAX_CONCURRENT=5
QUEUE_MAX_ATTEMPTS=5
QUEUE_MIN_BACKOFF="30s"
QUEUE_MAX_BACKOFF="600s"
QUEUE_MAX_PER_SECOND=1
QUEUE_LOG_SAMPLING=1.0

# Cloud Run (used by slice 3.2). The timeout is the 10-minute job lease.
RUN_CPU=1
RUN_MEMORY="512Mi"
RUN_CONCURRENCY=20
RUN_TIMEOUT=600
RUN_PORT=8080
RUN_MIN_INSTANCES=0
RUN_MAX_INSTANCES=1
# CPU boost is off on purpose (cold starts are accepted): the flag is --no-cpu-boost.

# Plain (non-secret) environment of the service, used by slice 3.2. Checked
# against apps/api/src/app/config/env.ts. Not set here, on purpose:
#   PORT (Cloud Run sets it), STORAGE_PUBLIC_URL (local development only),
#   INTERNAL_OIDC_AUDIENCE and INTERNAL_OIDC_SERVICE_ACCOUNT (computed by deploy.sh).
RUN_ENV_VARS=(
  NODE_ENV=production
  JOB_QUEUE=cloud-tasks
  "GCP_PROJECT_ID=${PROJECT_ID}"
  "CLOUD_TASKS_LOCATION=${REGION}"
  "CLOUD_TASKS_QUEUE=${QUEUE_NAME}"
  SUPABASE_URL=https://gadguyuxdxjmxtxnwlsv.supabase.co
  DATABASE_TLS=verify
  AUDIO_BUCKET=audio
  ANTHROPIC_MODEL=claude-haiku-5-5
  ELEVENLABS_MODEL=eleven_v4_turbo
  # Nest's ConsoleLogger adds ANSI colours to Cloud Logging otherwise.
  NO_COLOR=1
)

# Alerts and budget (slice 3.3; ARCHITECTURE.md section 12). The alert email address is NOT
# here: alerts.sh reads ALERT_EMAIL from the environment (or asks for it in a terminal), so no address is ever committed.
ALERT_EMAIL_PLACEHOLDER="alert@example.invalid" # DRY_RUN only, so a dry run works offline
ALERT_CHANNEL_NAME="Sleep Stories alerts (email)"
ALERT_POLICY_ENQUEUE="Sleep Stories: Cloud Tasks enqueue failed"
ALERT_POLICY_SWEEP="Sleep Stories: the jobs-sweep attempt failed"
# A log-match policy notifies at most once per this period and closes its incident after
# ALERT_AUTO_CLOSE (the API's minimum is 1800s).
ALERT_RATE_LIMIT="3600s"
ALERT_AUTO_CLOSE="86400s"
# Command groups the scripts use beyond `run deploy`, probed with a local --help (no API call)
# at the start of every real run, so a missing component is named before anything changes.
GCLOUD_PROBES=(
  "beta services identity create"
  "beta monitoring channels create"
  "monitoring policies create"
  "billing budgets create"
  "scheduler jobs create http"
  "tasks queues create"
  "artifacts repositories create"
)

# Fixed log lines of apps/api (cloud-tasks-job-queue.ts, queue-top-up.service.ts and others).
ALERT_ENQUEUE_LINE="Cloud Tasks queue: the job was not enqueued"
ALERT_ENQUEUE_CALLER_LINE="Enqueueing a generation job failed"

# The Google Cloud budget only NOTIFIES; it does not stop spending. The currency must be
# the currency of the billing account: if the API reports a mismatch, change "USD" here.
BUDGET_DISPLAY_NAME="Sleep Stories monthly budget"
BUDGET_AMOUNT="5USD"
BUDGET_THRESHOLDS=(0.5 0.9 1.0) # fractions of the amount: 50%, 90%, 100%
