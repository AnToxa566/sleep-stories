#!/usr/bin/env bash
# Container smoke test for the API image: `npx nx docker-smoke api`.
#
# This is a test, not a helper. It builds the image and proves, with real containers, that
# the packaged API boots, serves, shuts down cleanly and refuses bad configuration. It exits
# non-zero on the first failed assertion and prints one success line at the end.
#
# It needs Docker and the local Supabase stack (`npx nx supabase-start api`, Postgres on
# 127.0.0.1:54322 with the schema applied). It uses ONLY the public local defaults that are
# also written in apps/api/.env.example (Postgres user and password `postgres`, a dummy key
# for every provider). It never reads apps/api/.env, which holds real cloud values.
#
# The one awkward part is the database address. The env schema allows plaintext Postgres
# only for a loopback host outside production (database-tls.ts), so inside the container the
# database has to look like 127.0.0.1:54322. A "forwarder" container (the same image, run
# with `node` as the entrypoint) listens on 127.0.0.1:54322 in its own network namespace and
# pipes each connection to host.docker.internal:54322 (Docker Desktop's name for the Mac).
# The API containers join that namespace (`--network container:<forwarder>`), so for them
# 127.0.0.1:54322 is the database. The forwarder also publishes the API port, because a
# container that joins another's namespace cannot publish ports itself.
#
# What this cannot prove: DATABASE_TLS=verify against the real Supabase pooler (the pinned
# CA, port 6543), Secret Manager, the Cloud Run port contract and a real Cloud Task (no
# credentials for Google exist here; assertion 8 proves only that the SDK is in the image, that
# the API boots with JOB_QUEUE=cloud-tasks and that a bad bearer is refused). Those are first
# seen on Cloud Run (ARCHITECTURE.md section 12).
set -euo pipefail

cd "$(dirname "$0")/../../.."   # repository root: the Docker build context

IMAGE="sleep-stories-api:smoke"
HOST_PORT="${SMOKE_PORT:-18080}"
RUN_ID="smoke-$$"
FWD="${RUN_ID}-fwd"
CONTAINERS=()

pass() { echo "  ok: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  # Always remove what this run started, whatever happened.
  local c
  for c in ${CONTAINERS[@]+"${CONTAINERS[@]}"}; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Public local defaults, copied from apps/api/.env.example. Not secrets.
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOCAL_ENV=(
  -e "DATABASE_URL=${LOCAL_DB}"
  -e "DATABASE_TLS=disabled-local-only"
  -e "SUPABASE_URL=http://127.0.0.1:54321"
  -e "SUPABASE_SERVICE_ROLE_KEY=dummy-not-a-key"
  -e "ANTHROPIC_API_KEY=dummy-not-a-key"
  -e "ELEVENLABS_API_KEY=dummy-not-a-key"
)

# True when the container's logs contain a fixed string. The logs are captured first and
# searched afterwards: `docker logs | grep -q` can lose to SIGPIPE under `pipefail` (grep
# exits at the first match, docker logs is killed, the pipeline reports failure), which
# makes a found line look missing.
log_has() { # <container> <string>
  local out
  out="$(docker logs "$1" 2>&1)"
  grep -qF -- "$2" <<<"$out"
}

# Waits until the container's logs contain a fixed string, or the container exits, or the
# time is up. Prints nothing; the caller asserts on the result.
wait_for_log() { # <container> <string> <seconds>
  local i
  for ((i = 0; i < $3; i++)); do
    if log_has "$1" "$2"; then return 0; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$1")" != "true" ]; then return 1; fi
    sleep 1
  done
  return 1
}

# Starts a container that must exit by itself with a non-zero code, and checks that its
# log contains the expected fixed text. $1 is the container name, $2 the expected text;
# the rest is passed to `docker run`.
expect_boot_refusal() {
  local name="$1" text="$2"
  shift 2
  CONTAINERS+=("$name")
  docker run -d --name "$name" "$@" >/dev/null
  local i
  for ((i = 0; i < 30; i++)); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ] && break
    sleep 1
  done
  [ "$(docker inspect -f '{{.State.Running}}' "$name")" = "true" ] && fail "$name kept running instead of refusing to boot"
  local code
  code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"
  [ "$code" != "0" ] || fail "$name exited with code 0"
  log_has "$name" "$text" || fail "$name exited ($code) but its log lacks: $text"
}

echo "== preflight"
docker info >/dev/null 2>&1 || fail "Docker is not running"
if ! (exec 3<>/dev/tcp/127.0.0.1/54322) 2>/dev/null; then
  fail "the local Supabase Postgres is not reachable on 127.0.0.1:54322 (run: npx nx supabase-start api)"
fi
pass "Docker is running and the local database port answers"

echo "== 1. the image builds"
docker build -q -f apps/api/Dockerfile -t "$IMAGE" . >/dev/null || fail "docker build failed"
pass "image built"

echo "== 7. the image is non-root and carries no env file"
uid="$(docker run --rm --entrypoint id "$IMAGE" -u)"
[ "$uid" != "0" ] || fail "the image runs as root"
pass "runs as uid ${uid}"
# Any file named .env or .env.* anywhere in the image. Run as root only for this read-only
# search, so find can enter root-only directories (the image itself still runs as `node`).
envfiles="$(docker run --rm --user root --entrypoint find "$IMAGE" / -xdev \( -name '.env' -o -name '.env.*' \) -type f)"
[ -z "$envfiles" ] || fail "env file(s) in the image: ${envfiles}"
pass "no .env file in the image"
# The build-only placeholder must not have leaked into the final image's configuration.
image_env="$(docker image inspect --format '{{json .Config.Env}}' "$IMAGE")"
if grep -q 'DIRECT_URL' <<<"$image_env"; then
  fail "DIRECT_URL is set in the image environment"
fi
pass "DIRECT_URL is not in the image environment"
app_files="$(docker run --rm --entrypoint ls "$IMAGE" -A /app | tr '\n' ' ')"
[ "$app_files" = "main.js node_modules package-lock.json package.json " ] || fail "unexpected content in /app: ${app_files}"
pass "/app holds only the bundle and its production dependencies"

echo "== 2. the API boots in the container and reaches the database"
CONTAINERS+=("$FWD")
docker run -d --name "$FWD" -p "127.0.0.1:${HOST_PORT}:8080" --add-host host.docker.internal:host-gateway \
  --entrypoint node "$IMAGE" -e "
    const net = require('net');
    net.createServer((c) => {
      const u = net.connect(54322, 'host.docker.internal');
      c.pipe(u); u.pipe(c);
      c.on('error', () => u.destroy()); u.on('error', () => c.destroy());
    }).listen(54322, '127.0.0.1');
  " >/dev/null
# The API's boot-time SELECT 1 goes through the forwarder, so wait until it accepts connections
# (otherwise a slow Node start on a loaded machine makes the run flaky).
forwarder_ready=0
for _ in $(seq 1 30); do
  if docker exec "$FWD" node -e "require('net').connect(54322, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))" >/dev/null 2>&1; then
    forwarder_ready=1; break
  fi
  sleep 1
done
[ "$forwarder_ready" = "1" ] || fail "the database forwarder did not start listening within 30 seconds"
# NODE_ENV=development and JOB_QUEUE=local override the image's production defaults; both are
# refused in production (env.ts), which assertion 6 checks.
API="${RUN_ID}-api"
CONTAINERS+=("$API")
docker run -d --name "$API" --network "container:${FWD}" \
  -e NODE_ENV=development -e JOB_QUEUE=local "${LOCAL_ENV[@]}" "$IMAGE" >/dev/null
wait_for_log "$API" "Application is listening" 60 || {
  docker logs "$API" 2>&1 | tail -15 >&2
  fail "the API did not start listening within 60 seconds"
}
log_has "$API" "Database connection verified" || fail "no 'Database connection verified' line"
pass "booted, @prisma/client, pg, the query compiler and the TLS code work in the image"

echo "== 3. the routes answer"
code() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }
base="http://127.0.0.1:${HOST_PORT}/api"
[ "$(code "${base}/")" = "200" ] || fail "GET /api/ did not return 200"
pass "GET /api/ -> 200"
[ "$(code "${base}/me")" = "401" ] || fail "GET /api/me without a token did not return 401"
pass "GET /api/me without a token -> 401"
[ "$(code -X POST -H 'Authorization: Bearer not-a-real-token' -H 'Content-Type: application/json' -d '{}' "${base}/internal/jobs/run")" = "401" ] \
  || fail "POST /api/internal/jobs/run with a bad bearer did not return 401"
pass "POST /api/internal/jobs/run with a bad bearer -> 401"

echo "== 4. SIGTERM runs the shutdown hooks"
docker stop -t 10 "$API" >/dev/null
log_has "$API" "Database connection closed" || {
  docker logs "$API" 2>&1 | tail -10 >&2
  fail "no 'Database connection closed' line after docker stop (shutdown hooks did not run)"
}
[ "$(docker inspect -f '{{.State.ExitCode}}' "$API")" = "0" ] \
  || fail "the API did not exit with code 0 after docker stop (it logged the line but did not finish cleanly)"
pass "docker stop produced the shutdown log line and a clean exit (code 0)"

echo "== 5. missing configuration crashes at boot"
expect_boot_refusal "${RUN_ID}-nokey" "ANTHROPIC_API_KEY is required" \
  -e NODE_ENV=development -e JOB_QUEUE=local \
  -e "DATABASE_URL=${LOCAL_DB}" -e DATABASE_TLS=disabled-local-only \
  -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_SERVICE_ROLE_KEY=dummy-not-a-key \
  -e ELEVENLABS_API_KEY=dummy-not-a-key "$IMAGE"
pass "without ANTHROPIC_API_KEY the process exits non-zero"

echo "== 6. the image's production defaults refuse the local queue"
# DATABASE_TLS is left unset and the URL is not loopback-plaintext, so JOB_QUEUE=local is the
# only thing wrong; the assertion is on its message.
expect_boot_refusal "${RUN_ID}-prodlocal" "JOB_QUEUE=local is for local development only" \
  -e JOB_QUEUE=local \
  -e "DATABASE_URL=postgresql://postgres:postgres@db.example.invalid:6543/postgres" \
  -e SUPABASE_URL=https://example.invalid -e SUPABASE_SERVICE_ROLE_KEY=dummy-not-a-key \
  -e ANTHROPIC_API_KEY=dummy-not-a-key -e ELEVENLABS_API_KEY=dummy-not-a-key "$IMAGE"
pass "with the image defaults (production), JOB_QUEUE=local exits non-zero"

echo "== 8. JOB_QUEUE=cloud-tasks: the SDK is in the image and the API boots with it"
# A production-mode boot cannot reach the plaintext local database (the TLS rule of env.ts,
# assertion 6), so this boot runs with NODE_ENV=development like assertion 2. The env schema
# accepts cloud-tasks there. All Google values are dummies of the right shape; the container has
# no Google credentials, so a boot that reaches "Application is listening" shows that nothing
# calls Google at boot. That the client is built lazily (at the first enqueue) is not proven here:
# building it needs no network, so an eager build would pass too; the bundle shows the lazy load.
CT_API="${RUN_ID}-ct"
CONTAINERS+=("$CT_API")
docker run -d --name "$CT_API" --network "container:${FWD}" \
  -e NODE_ENV=development -e JOB_QUEUE=cloud-tasks \
  -e INTERNAL_OIDC_AUDIENCE=https://example-123456.europe-west1.run.app \
  -e INTERNAL_OIDC_SERVICE_ACCOUNT=tasks@example-123456.iam.gserviceaccount.com \
  -e GCP_PROJECT_ID=example-123456 -e CLOUD_TASKS_LOCATION=europe-west1 -e CLOUD_TASKS_QUEUE=example-queue \
  "${LOCAL_ENV[@]}" "$IMAGE" >/dev/null
wait_for_log "$CT_API" "Application is listening" 60 || {
  docker logs "$CT_API" 2>&1 | tail -15 >&2
  fail "the API did not start listening with JOB_QUEUE=cloud-tasks within 60 seconds"
}
pass "booted with JOB_QUEUE=cloud-tasks and dummy Google settings"
# The SDK must survive the dependency prune and the image. Loaded from /app, where the API
# resolves it; the client is built (no network I/O) the way the adapter builds it.
docker exec "$CT_API" node -e "
  const { CloudTasksClient } = require('@google-cloud/tasks');
  const client = new CloudTasksClient({ fallback: 'rest' });
  const path = client.queuePath('example-123456', 'europe-west1', 'example-queue');
  if (path !== 'projects/example-123456/locations/europe-west1/queues/example-queue') process.exit(1);
  client.close().then(() => process.exit(0));
" >/dev/null 2>&1 || fail "@google-cloud/tasks cannot be loaded and built inside the image"
pass "@google-cloud/tasks loads in the image and builds a REST client"
# The OIDC verifier path: a bad bearer is refused with 401, not accepted and not a 503. The
# token is not a JWT, so jose rejects it without fetching Google's keys.
[ "$(code -X POST -H 'Authorization: Bearer not-a-real-token' -H 'Content-Type: application/json' -d '{}' "${base}/internal/jobs/run")" = "401" ] \
  || fail "POST /api/internal/jobs/run with a bad bearer did not return 401 with JOB_QUEUE=cloud-tasks"
pass "POST /api/internal/jobs/run with a bad bearer -> 401 with JOB_QUEUE=cloud-tasks"

echo
echo "DOCKER SMOKE PASSED: image builds, boots, serves, shuts down cleanly and refuses bad configuration"
