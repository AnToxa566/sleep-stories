# Production runbook (Google Cloud)

Scripts and steps that put the API on Google Cloud (ARCHITECTURE.md section 12). Part 1 is the foundation (APIs, accounts, secrets, the queue); part 2 is the image, the database, the deploy and the live checks; part 3 is the alerts, the budget and the vendor spend limits, then the table of all steps and what is left that no script covers. Names and numbers are in `config.sh`; nothing here is a secret.

Who does what: **O** is the owner at a terminal; **S** is a script the owner starts.

## Rules that hold for every script

- Every Google Cloud call goes through one wrapper in `lib.sh` that adds `--project=sleep-stories-513914`. The default project of `gcloud` on the owner's Mac is another project, so a bare call must never exist. `bash infra/check.sh` fails on one.
- `DRY_RUN=1 bash infra/<script>` prints every change command (shell-quoted, so you can paste it), runs none of them and calls no `gcloud` at all. Only unset, `0` and `1` are accepted: `DRY_RUN=true` stops every script with an error, because it would otherwise run for real. The read-back at the end shows `SKIPPED`. Read this output before the real run: each line is `DRY-RUN: gcloud ...`; the resource names, the roles and the `--member` are what will be created or granted.
- Scripts are idempotent: a resource that exists is kept (or updated: the queue, the registry flags, the cleanup policy). Re-running after a failure is safe.
- Scripts only add IAM bindings. They never remove one. To take a role back, run by hand: `gcloud <group> remove-iam-policy-binding <resource> --member=... --role=... --project=sleep-stories-513914`.
- No script takes a secret as an argument. `bootstrap.sh` creates empty secrets and never adds a version. Only `set-secret.sh` stores a value, read hidden from the terminal.
- Every script ends with a `RESULT:` block (names, versions, PASS or FAIL, never values).

**When you report back, paste the `RESULT:` block and any `ERROR` line. Do not paste the full `gcloud` output.**

## Part 1: the foundation

### Step 0. O: prepare `gcloud`

Billing is already enabled on the project. `gcloud` 564 needs Python 3.10 or newer to load some command groups (`run` among them); the system Python 3.9 is too old. Point `gcloud` at a newer one for this shell:

```sh
export CLOUDSDK_PYTHON="$(uv python find 3.12)"   # the path is specific to the machine
gcloud auth login
```

The scripts check at the start of every real run that `gcloud` can load the command groups they use (a local `--help`, no API call) and name a missing one. `beta` is needed (the Monitoring channel and the service agents): install it once with `gcloud components install beta`. The scripts print the Python hint themselves when `gcloud` cannot load. You need no `gcloud config set project`: every call passes `--project`.

### Step 1. S: `bootstrap.sh`

```sh
DRY_RUN=1 bash infra/bootstrap.sh    # read the printed commands first
bash infra/bootstrap.sh              # then the real run; safe to repeat
```

What it does, in order: enables 11 APIs; creates the Docker repository `api` in `europe-west1` (vulnerability scanning off; cleanup policy keeps the 2 most recent images and deletes anything older than a day, applied for real with `--no-dry-run`); creates the service accounts `api-runtime` and `tasks-invoker`; creates the 5 empty secrets, replicated only in `europe-west1`; lets `api-runtime` read the four runtime secrets (not `DIRECT_URL`); lets `api-runtime` act as `tasks-invoker`; creates the queue `generation-jobs` (or updates its settings) and lets `api-runtime` enqueue to that queue. `tasks-invoker` gets no project role: Cloud Run is public and the app checks the token itself. The last lines are the `RESULT:` block; one line shows `api-runtime does NOT read DIRECT_URL`, which must say PASS.

A secret with `EMPTY` in the block still needs step 2. IAM answers can lag a few seconds after a creation; the script retries a binding up to 5 times, and a read-back `FAIL` right after a creation is cured by running the script again.

Cleanup policy risk: an image that is neither one of the 2 newest nor younger than a day is deleted, and a cold start of a service whose image is gone fails. Deploy a new image before the running one is two pushes old.

### Step 2. O: store the secrets

Once per secret, in a terminal you type in (the script refuses a pipe, and asks twice):

```sh
bash infra/set-secret.sh DATABASE_URL
bash infra/set-secret.sh DIRECT_URL
bash infra/set-secret.sh SUPABASE_SERVICE_ROLE_KEY
bash infra/set-secret.sh ANTHROPIC_API_KEY
bash infra/set-secret.sh ELEVENLABS_API_KEY
```

- `DATABASE_URL`: the Supabase **Transaction pooler** string, port **6543**. No `ssl*` and no `pgbouncer` parameters (the API sets TLS in code and refuses such parameters). The password must be URL-encoded.
- `DIRECT_URL`: the Supabase **Session pooler** string, port **5432**. Used only by the migration (slice 4); `api-runtime` cannot read it.
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`: the keys as the providers show them. Create a **production-only Anthropic key** (do not reuse the development key).
- **Set the vendor spending limits now, by hand, before the keys can be used from Cloud Run** (no script can; the Google Cloud ceiling `--max-instances=1` does not bound provider spend, only the vendor limits and the 5-per-day allowance per person do): (1) **Anthropic:** Console, a spend limit, ideally the production key in its own workspace with its own limit; (2) **ElevenLabs:** a usage or spend limit in the account settings (text-to-speech credits). Sign-up is open (see "Decisions left to you"), so these limits are the real brake.
- A line typed in a terminal is limited to about 1000 characters; every value here is shorter.
- The script prints only the new version number. It refuses an empty value, a value with leading or trailing whitespace, and two entries that differ.
- Each run adds a version. Old versions stay enabled until you destroy them (`gcloud secrets versions destroy <N> --secret=<NAME> --project=sleep-stories-513914`); about 6 active versions are free. `deploy.sh` pins the newest enabled version number of each runtime secret, so after a rotation the service must be deployed again to pick it up (a disabled or destroyed version is never pinned).
- **Rotation order:** (1) `set-secret.sh <NAME>`, (2) `deploy.sh <tag>` and read its `secret versions pinned` line to see the new number, (3) only then disable or destroy the old version. The service pins version numbers and scales to zero, so if the version a running revision pins is destroyed first, every later cold start fails.

Check: run `bash infra/bootstrap.sh` again and read that no secret shows `EMPTY`.

## Part 2: the image, the database, the deploy, the live checks

Order: steps 3 and 4 (Supabase) and step 5 (the image) do not depend on each other. Step 6 needs steps 2, 4 and 5. Step 7 needs step 6. Step 8 (alerts and budget) needs step 6; the vendor spending limits belong to step 2.

### Step 3. O: Supabase storage

In the Supabase dashboard of the production project:

1. Storage, new bucket `audio`: **public bucket OFF** (private), file size limit **50 MiB** (the Free plan maximum; one story is about 3 MB).
2. Upload the four voice samples, the files you made by hand (they are not in the repository), to exactly these paths: `voices/maxim/sample.mp3`, `voices/anna/sample.mp3`, `voices/lev/sample.mp3`, `voices/kate/sample.mp3`. The seed in step 4 writes these paths into the `voices` table.
3. SQL editor: `show server_version;`. Locally it is 17. If the major version differs, tell the chat before step 4.

### Step 4. O: migrate and seed the production database

First: if the Supabase Free project was paused for inactivity, restore it in the dashboard and wait until it is up; the migration would time out against a paused project.

Run from a trusted network (home, not a café or a hotspot): the Prisma CLI connection used by the migration encrypts but does not verify the server certificate (ARCHITECTURE.md section 11, item 6). The seed verifies it.

1. In `apps/api/.env` (never print the file): comment out the local `DATABASE_URL`, `DIRECT_URL` and `DATABASE_TLS` lines, and remove the `# cloud: ` prefix from the two cloud lines (AGENTS.md, "Database setup"). `DATABASE_TLS` must stay unset: the seed refuses `disabled-local-only` for a host that is not on this machine.
2. `npx nx prisma-migrate-status api --outputStyle=static` shows what is not applied yet.
3. `npx nx prisma-migrate-deploy api --outputStyle=static` applies the migrations (`init`, `drop_voice_asleep_prompt_audio_path`).
4. `SEED_ALLOW_REMOTE=yes npx nx prisma-seed api --outputStyle=static`. The seed refuses a database that is not on this machine unless `SEED_ALLOW_REMOTE=yes` is set (`prisma/seed-target.ts`); it prints `Seeding a REMOTE database` and counts, never the URL. It is safe to repeat. The seed also loads the ten interests that onboarding shows (owner, 2026-11-07: this is the real list, nothing to replace).
5. Check row level security in the SQL editor. Expect `rls_on` 15 (14 tables and `_prisma_migrations`) and `rls_off` 0:

```sql
select count(*) filter (where relrowsecurity) as rls_on,
       count(*) filter (where not relrowsecurity) as rls_off
from pg_class
where relnamespace = 'public'::regnamespace and relkind in ('r', 'p');
```

6. Put `apps/api/.env` back to the local block (uncomment the local lines, restore `DATABASE_TLS`) and **remove the values from the two `# cloud:` lines** (leave the names, or delete the lines). These are the production passwords: a second copy outside Secret Manager is a risk, and `npx nx serve api` with the cloud lines active would run against production. The integration tests and the seed refuse a remote database; `serve` does not. Copy the strings again from the Supabase dashboard when you need them.
7. **Before step 6 (deploy)**, in the SQL editor, expect NO rows:

```sql
select kind, status, count(*) from generation_jobs where status in ('pending','running') group by 1,2;
```

   The Scheduler sweep fires within 10 minutes of the first deploy and re-enqueues any pending or running job, `write_story` and `render_audio` included, which would be paid generation nobody asked for in this run (architecture rule 10 in spirit). If rows exist, look at them with the chat first.

### Step 5. S: build and push the image

Once: `gcloud auth configure-docker europe-west1-docker.pkg.dev` (answer yes; it adds a credential helper to your Docker config). That helper runs `gcloud`, so the shell that pushes needs `CLOUDSDK_PYTHON` exported as in step 0.

```sh
git status                              # commit your changes first: the tag is the commit
DRY_RUN=1 bash infra/push-image.sh      # read the build command
bash infra/push-image.sh
```

- Docker Desktop must be running. The script refuses when `apps`, `packages`, `package.json`, `package-lock.json`, `nx.json`, `tsconfig.base.json` or `.dockerignore` have uncommitted changes (the `infra/` scripts may be uncommitted). Tag = the first 12 characters of the commit id.
- Give Docker Desktop at least 4 GB of memory (Settings, Resources): the emulated build can run out of memory during `npm ci` or the webpack build, and then dies with a killed process.
- Cloud Run needs `linux/amd64` and this Mac is arm64, so the build runs under emulation. The first build is slow (many minutes, mostly `npm ci` and the webpack build); later ones reuse the cache.
- `--provenance=false`: without it the registry gets two versions per tag and the keep-2 cleanup policy counts wrongly.
- The script prints the image reference and the tag. Use the tag in step 6. A tag that is already in the registry is not rebuilt.

### Step 6. S: deploy to Cloud Run and create the Scheduler job

```sh
DRY_RUN=1 bash infra/deploy.sh <tag>    # read every command
bash infra/deploy.sh <tag>
```

It: checks the image tag is in the registry; makes sure the Cloud Tasks and Cloud Scheduler service agents exist; grants the Cloud Tasks service agent `roles/iam.serviceAccountUser` on `tasks-invoker` (Google's "Create HTTP target tasks" page); pins each runtime secret to its newest enabled version (it stops and names the secret if one has none); deploys `sleep-stories-api` (1 vCPU, 512 MiB, concurrency 20, timeout 600 s, 0 to 1 instances, request-based CPU, no startup CPU boost, public, port 8080, runtime account `api-runtime`) with the plain environment of `config.sh`, `INTERNAL_OIDC_AUDIENCE` and `INTERNAL_OIDC_SERVICE_ACCOUNT`; stops loudly unless the URL Cloud Run reports is exactly the audience it computed; creates or updates the Scheduler job `jobs-sweep` (`*/10 * * * *`, UTC, POST to `/api/internal/jobs/sweep`, signed as `tasks-invoker` for the audience, no retry, attempt deadline 660 s). The settings are SET each time, so a value removed from `config.sh` disappears from the service.

- Every deploy makes a **new revision** and can cut a generation that is running. Deploy when nothing is being generated.
- A code or config change (for example the TTS model, `ELEVENLABS_MODEL` in `infra/config.sh`) reaches production only through `bash infra/push-image.sh` and then `bash infra/deploy.sh <tag>`; nothing else restarts the service with the new code.
- `--allow-unauthenticated` makes the service public on purpose; the app checks the Supabase token and `/internal/*` checks the Google token. If an organisation policy forbids `allUsers`, the deploy says so; tell the chat.
- The cold start of the first request after a deploy takes some seconds.

### Step 7. S and O: the live checks

```sh
bash infra/smoke.sh basic
```

It checks that `GET /api` answers 200; that `/run` and `/sweep` answer 401 with no token, with a made-up bearer and with your own `gcloud` identity token (that token is passed to `curl` on standard input and never printed; if `gcloud` gives no token, that probe FAILS, because it is part of the proof); then it creates one real Cloud Task on `generation-jobs` for an unknown job id and waits up to 3 minutes for the Cloud Run request log to show a POST to `/run` with status 200. That 200 can only come from a task whose token the API accepted. The unknown job id writes nothing.

Then the sweep. In the Supabase SQL editor insert one stuck test job (`suggest_topics` with an empty payload: the run rejects it as invalid and fails it for good, so no model is ever called and nothing is paid; the row is made to look 5 minutes old so that the sweep picks it up):

```sql
insert into generation_jobs (kind, payload, dedupe_key, created_at)
values ('suggest_topics', '{}'::jsonb, 'smoke:' || gen_random_uuid(), now() - interval '5 minutes')
returning id, status;
```

```sh
bash infra/smoke.sh sweep
```

It runs the Scheduler job now and waits for: a 200 on `/sweep`, a Cloud Tasks call to `/run` with a 200 that started after the job was run (5 seconds of margin; it cannot tell the test row from another job that was pending at that moment), the line `A job failed for good`. Then it checks that no line `Cloud Tasks queue: the job was not enqueued` exists in the last day (`SMOKE_SINCE=<time of the last good deploy, 2026-11-07T10:00:00Z form>` narrows that window after an earlier failed attempt), and scans the last hour of application logs for `Bearer `, JWT-looking text, an Anthropic key, a Supabase secret key and an email address (counts only). Then delete the test row:

```sql
delete from generation_jobs where dedupe_key like 'smoke:%';
```

## Part 3: alerts, the budget, the vendor limits, and what is left

### Step 8. S and O: alerts and budget

```sh
DRY_RUN=1 bash infra/alerts.sh                       # read the commands; a placeholder address is printed
ALERT_EMAIL=<your address> bash infra/alerts.sh      # the real run
bash infra/alerts.sh                                 # in a terminal, without ALERT_EMAIL: it asks for the address (not kept in the shell history)
```

The script refuses (before any `gcloud` call) when there is no plausible address (neither `ALERT_EMAIL` nor, in a terminal, a typed one). The address is your own: the scripts never print it and it is never committed, but it does appear in the argument list of `gcloud` (visible in `ps` while it runs) and in `gcloud`'s own log file on your Mac (`~/.config/gcloud/logs`), and `ALERT_EMAIL=... bash ...` lands in your shell history (the prompt avoids that). It creates or updates, found by display name: one email notification channel; two log-match alert policies (one notification per hour at most, incident closed after a day); and a monthly budget of `BUDGET_AMOUNT` in `config.sh` (5 USD) for this project, with email notifications at 50%, 90% and 100% of it, sent to the channel and to the billing account's own administrators.

- Policy 1, **enqueue failed**: a Cloud Run log line `Cloud Tasks queue: the job was not enqueued` (or the callers' `Enqueueing a generation job failed`) from the service `sleep-stories-api`. The job stays `pending` until the sweep finds it; read the code in the line (see "When something fails").
- Policy 2, **sweep attempt failed**: a Cloud Scheduler log entry of the job `jobs-sweep` with severity ERROR. The sweep itself logs nothing, so this is its only failure signal. The documentation I could read names the `AttemptStarted` and `AttemptFinished` entries but not their severity, so after the first run open Logs Explorer with `resource.type="cloud_scheduler_job" resource.labels.job_id="jobs-sweep"`, read one entry of a normal attempt, and check that a failure would be ERROR. If a failed attempt is logged at a lower severity, tell the chat and the filter changes.
- Both policies and the channel cost nothing today: Google's pricing page says charging for alerting policies starts no sooner than 2027-09-01, at $0.35 a month per metric reference; a log-match policy has one condition. Email channels have no price of their own.
- **A budget does not stop spending.** It only sends email. The Google Cloud ceiling is `--max-instances=1` on Cloud Run (`config.sh`); provider spend is bounded only by the vendor limits (step 2) and the 5-per-day allowance.
- If the budget call says the currency does not match, set `BUDGET_AMOUNT` in `config.sh` to your billing account's currency (for example `5EUR`) and run the script again.

The Anthropic and ElevenLabs spending limits are set in step 2; confirm they are set before you rely on any of this.

Check: the `RESULT:` block shows PASS for the channel, both policies and the budget. To test the email path once, in the Cloud Monitoring console open the channel and send a test notification.

### Step 9. O: checks from outside Google Cloud

From a terminal (the publishable key is the public one that the app also holds):

```sh
# 1. A table read with the publishable key returns nothing: RLS is on and there are no policies.
curl -s -H "apikey: <publishable key>" "https://<project ref>.supabase.co/rest/v1/voices?select=*"
# expect [] (an empty list) or an error; never rows

# 2. An unsigned URL to a stored file is refused (the bucket is private).
curl -s -o /dev/null -w '%{http_code}\n' "https://<project ref>.supabase.co/storage/v1/object/public/audio/voices/maxim/sample.mp3"
# expect 400 or 404; never 200
```

The project reference is the first part of `SUPABASE_URL` in `config.sh`.

### Order at a glance

| Step | Who | What | Command |
|---|---|---|---|
| 0 | O | `gcloud` login and Python | `export CLOUDSDK_PYTHON=...`, `gcloud auth login` |
| 1 | S | APIs, registry, accounts, empty secrets, queue | `bash infra/bootstrap.sh` |
| 2 | O | Store the five secrets; set the Anthropic and ElevenLabs spending limits | `bash infra/set-secret.sh <NAME>` (five times); vendor consoles |
| 3 | O | Supabase bucket `audio` (private) and four voice samples | Supabase dashboard |
| 4 | O | Migrate and seed the production database; check RLS | `npx nx prisma-migrate-deploy api`, `SEED_ALLOW_REMOTE=yes npx nx prisma-seed api` |
| 5 | S | Build and push the image | `bash infra/push-image.sh` |
| 6 | S | Deploy to Cloud Run, create the Scheduler job | `bash infra/deploy.sh <tag>` |
| 7 | S, O | Live checks (basic, then the sweep with one test row) | `bash infra/smoke.sh basic`, `bash infra/smoke.sh sweep` |
| 8 | S, O | Alerts and budget | `ALERT_EMAIL=<address> bash infra/alerts.sh` |
| 9 | O | Checks from outside Google Cloud | two `curl` calls |

Every script can be read first with `DRY_RUN=1`. Steps 3 and 4 and step 5 do not depend on each other.

### Definition of done for this runbook

All of these, each shown by a pasted `RESULT:` block or a check result (nothing is done because it looks right):

- Steps 1, 6 and 8 end with `RESULT: PASS`, and step 1's block has no `EMPTY` secret.
- `smoke.sh basic` and `smoke.sh sweep` end with `RESULT: PASS`, and the test row is deleted.
- Step 4's SQL shows `rls_on` 15 and `rls_off` 0; step 9 returns an empty list and a 400 or 404.
- The email test from step 8 arrived, and the vendor limits (Anthropic, ElevenLabs, step 2) are set.
- The pre-launch items below that apply to this deployment are done or consciously accepted by the owner.

The pre-launch checklist in SECURITY.md is ticked only by the owner, one item at a time, after its own check has been run.

### Still to do before a real release (no script covers these)

Reminders only; the decisions are in the linked documents.

- **Email confirmation and SMTP** in the cloud Supabase project (off locally; SECURITY.md checklist and ARCHITECTURE.md section 11, item 23).
- **`npm audit`** reviewed, the remaining findings accepted explicitly (SECURITY.md checklist).
- **The app's production settings:** put these three into `apps/mobile/.env` before a release build (AGENTS.md, Commands): `EXPO_PUBLIC_API_URL` = the audience printed by `deploy.sh` **plus `/api`** (the API's global prefix; `apps/mobile/.env.example` shows the same form, `http://<LAN-IP>:3000/api`), and `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` of the cloud project.
- **The release build and its signing keystore:** build locally (AGENTS.md, Commands; ARCHITECTURE.md section 12, "Audience and distribution") and keep a backup of the keystore: an APK signed with another key cannot be installed over the old one.

### Decisions left to you

These are yours; nothing here decides them.

1. **Open sign-up: kept open (owner, 2026-11-07).** Only the owner and one more person see the app. If it ever goes beyond that, anyone can create unlimited accounts at 5 generations each per 24 hours; this is recorded as open problem 37 in ARCHITECTURE.md.
2. **The Artifact Registry cleanup policy: stays at 2 images (owner, 2026-11-07).** It keeps only 2 images and deletes anything older than one day. Two pushes without a successful deploy more than a day apart can delete the image the service runs, and the next cold start then fails until you deploy again; rollback goes back one image only. If that ever happens, run `bash infra/push-image.sh` and `bash infra/deploy.sh <tag>` again.
3. **Log alerts: decided against (owner, 2026-11-07).** The only alert is the Google Cloud budget, which the owner set by hand; `infra/alerts.sh` has not been run and no log-alert policy exists. The owner says he will ask if he ever wants them. (They would catch, for example, tasks refused with 401 after a configuration drift; no paid call happens in that case, jobs just stay pending.)

### For slice 4 (not built; deferred by the owner on 2026-11-07, facts for the planner if it is ever started)

- `deploy.sh` mixes one-time wiring (service-agent creation, the `serviceAccountUser` binding on `tasks-invoker`, the Scheduler job, `--allow-unauthenticated`) with the per-release deploy. Before the workflow is written it should be split into an owner-only wiring script and a per-release deploy, so that `gh-deploy` needs no IAM-admin rights.
- `gh-migrate` would run from a GitHub-hosted runner, which is not a "trusted network" for the Prisma CLI whose TLS is unverified (ARCHITECTURE.md section 11, item 6). Take this to the owner before building it.
- `preflight` needs a CI mode (no interactive account, no `gcloud auth list` assumptions).
- The image may be pushed only from the deploy workflow once it exists.
- Any new GitHub Action is a new dependency: ask first (AGENTS.md rule 7).

## What to paste back to the chat

The `RESULT:` block of each script and any line that starts with `ERROR`. For the SQL checks, the result row. Nothing else: no full `gcloud` or `docker` output, no `.env`, no key or password, no Authorization header.

## When something fails

- **A task or the sweep reaches the API and gets 401** (smoke: "reached /run" fails, or the console shows 401s). Open Logs Explorer for the service and read the line `Internal credential rejected (<reason>)`: the reason names the check that failed (audience, account, expiry). `deploy.sh` already grants binding 1 below. If the tasks are still refused, add binding 2 (and, for the Scheduler job, the same for its agent), each as `gcloud iam service-accounts add-iam-policy-binding tasks-invoker@sleep-stories-513914.iam.gserviceaccount.com --member=serviceAccount:<agent> --role=<role> --project=sleep-stories-513914 --format=none`:
  1. `roles/iam.serviceAccountUser` for `service-<PROJECT_NUMBER>@gcp-sa-cloudtasks.iam.gserviceaccount.com` (the documented grant).
  2. `roles/iam.serviceAccountOpenIdTokenCreator` for the same agent, and for `service-<PROJECT_NUMBER>@gcp-sa-cloudscheduler.iam.gserviceaccount.com`.
  
  The log line `Internal authentication unavailable (<reason>)` (the 503 response body says only "Authentication is unavailable") means the API could not fetch Google's public keys; Cloud Tasks retries.
- **`(code 7)` on enqueue**, in the log line `Cloud Tasks queue: the job was not enqueued (code 7)`: permission denied. `api-runtime` lacks `roles/cloudtasks.enqueuer` on the queue or `roles/iam.serviceAccountUser` on `tasks-invoker`. Run `bash infra/bootstrap.sh` and read the two RESULT lines about them. Code 5 means the queue name or location is wrong.
- **`deploy.sh` stops with "the service URL is ..., not ..."** (the URL check, after the deploy and before the Scheduler job): the service is already live and public, but the Scheduler job does not exist yet. Tell the chat; the service stays up; do not run smoke; nothing is scheduled.
- **The image build is killed or runs out of memory**: give Docker Desktop at least 4 GB (step 5).
- **`image tag ... is not in the registry`**: run `bash infra/push-image.sh` and use the tag it prints. The cleanup policy deletes any image that is not one of the 2 newest and is older than a day, so an old tag can be gone: push again.
- **`secret ... has no enabled version`**: `bash infra/set-secret.sh <NAME>`. Disabled and destroyed versions do not count.
- **`gcloud` crashes or says a command group cannot load, or a Docker push says the credential helper failed**: the system Python is too old. `export CLOUDSDK_PYTHON="$(uv python find 3.12)"` in that shell (step 0).
- **The deploy fails with "container failed to start and listen on the port"**: the API refuses to boot on a bad configuration and names the variable, never the value. Read the revision's log in the Cloud Run console. The usual cause is a malformed secret value (for example `DATABASE_URL` with an `ssl*` parameter).
- **`alerts.sh` says the budget currency does not match** (or the API reports a currency error): set `BUDGET_AMOUNT` in `config.sh` to your billing account's currency, for example `5EUR`, and run it again. Other errors on the budget call usually mean the account lacks the Billing Account Costs Manager role (or Administrator) on the billing account, or the Cloud Billing Budget API is not enabled (`bootstrap.sh` enables it).
- **`alerts.sh` stops with `ALERT_EMAIL is not set and there is no terminal to ask`**: nothing was called. Run it in a terminal (it asks for the address) or as `ALERT_EMAIL=<address> bash infra/alerts.sh`. The address is not written to any file of the repository.
- **`alerts.sh` stops with `could not list existing resources`**: a `gcloud` read failed (permission, the Monitoring or Billing Budget API, a network error); the lines above it say which. Nothing is created after a failed listing, so a re-run cannot make a duplicate.
- **`smoke.sh sweep` finds no `/sweep` or no `/run` 200**: the test row was not inserted, or the Scheduler job is paused. Also look at the job in the Cloud Scheduler console.

## Checking the scripts without Google

`bash infra/check.sh` needs no login and calls no `gcloud`. It runs, under `/bin/bash` (3.2 on a Mac) where it matters: the syntax check, `shellcheck` if installed, the dry run of every script, and these tests against a stub `gcloud` that logs every call: `alerts.sh` stops before any call without a plausible address; `alerts.sh` creates and updates nothing when a `gcloud` listing fails (it must not read a failed listing as "nothing exists" and create a duplicate); every script refuses `DRY_RUN=true`, `yes`, `on` and `2`. A missing `gcloud` component (for example `beta`) is named at the start of a real run, before any other call. It also applies text rules: no tracing; no `gcloud` word outside `lib.sh` except in a message line, and none in command position (also after `if`, `elif`, `while`, `until`, `time`, `command`, `exec`, `env`, quotes, backticks or `$(`; the guard is tested against each of these forms); `lib.sh` holds exactly its four call lines; secret versions touched only in `set-secret.sh`; no secret-looking literal; no email address in `infra/` except `*.iam.gserviceaccount.com` addresses and the dry-run placeholder; the identity token read in one place and never printed; no Authorization literal; only `docker info` and `docker buildx build`; `deploy.sh` never names `DIRECT_URL` or a floating secret version. It ends with `infra check: OK`.
