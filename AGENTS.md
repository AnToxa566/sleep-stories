# Sleep Stories: guide for coding agents

Sleep Stories is a mobile app that plays a queue of short, AI-generated Russian-language stories so a person can fall asleep to them. Stack: Nx monorepo (npm), Expo (React Native) app, NestJS API on Google Cloud Run, Supabase (Postgres, Auth, Storage) with Prisma, Cloud Tasks for background jobs.

## Read first

- `ARCHITECTURE.md`: boundaries, data model, every decision with its reasoning, what is deferred or rejected, and the open problems. It records why, not only what. Use its reasoning instead of deriving your own.
- `SECURITY.md`: threat model and the pre-launch checklist. Read it whenever a change touches keys, auth, data access, storage, internal endpoints, prompts or the microphone.
- `design/`: the screen designs, exported from Claude Design. Read the matching design before building or changing any screen. The folder is git-ignored and exists only on the owner's machine: if it is missing, ask the owner, and never invent a design or copy files from it into the repository. The designs contain mistakes. There are no series of stories ("Продолжить серию" is a designer's error and never will be built; ARCHITECTURE.md section 10), and anything else a design shows that the architecture lacks is a question for the owner.

If a plan conflicts with this file or with `ARCHITECTURE.md`, stop and flag it. Do not resolve it silently in either direction.

## Non-negotiable rules

### Architecture rules

1. Module boundaries: `apps/mobile` and `apps/api` may import only from `packages/contracts`; they never import each other. `packages/contracts` imports only `zod`.
2. Paid or secret-bearing SDKs (`@anthropic-ai/sdk`, the TTS SDK, the Supabase service-role client) are imported only inside their adapter (`LlmProvider`, `TtsProvider`, the storage service) in `apps/api`. Nothing else calls them.
3. Prisma Migrate owns the database schema. No manual schema changes. No foreign keys into Supabase's `auth` schema: reference the auth user id as a plain uuid.
4. Story content (`topics`, `stories`, `story_audio`) is user-independent and has no owner column. Per-user state lives in `user_preferences`, `user_interests`, `user_custom_interests`, `user_topics`, `queue_items`, `listens` and `story_ratings`. The listen outcome (finished or skipped) is derived from `listened_sec` and the audio duration and is never stored. User intent and generation health are never combined into one enum.
5. A story is generated whole: one LLM call, one TTS request, one audio file. No chunking, no ffmpeg, no audio post-processing.
6. Background work runs only through Cloud Tasks, with Cloud Scheduler for periodic triggers. No fire-and-forget work after the HTTP response, no Redis, no BullMQ.
7. Only libraries named in `ARCHITECTURE.md` are used. Do not add a dependency, including Sentry, an i18n library or SQLite, without asking the owner.
8. The UI is dark-only and never uses pure white. Copy is Russian and lives in one strings module. Each screen has one primary action.
9. Anything listed under "Known open problems" in `ARCHITECTURE.md` is not yours to decide. Stop and ask.
10. Nothing that costs money is generated on its own. `write_story` and `render_audio` jobs are created only by an explicit action of the person (the main button on «Сегодня», «Создать сейчас», «Повторить»); never by onboarding, the queue top-up, adding to the queue, «Другая история», a replacement or a tap on a topic. The only automatic stage is the choice of topics (`suggest_topics`, capped at 5 per person per 24 hours). One generation costs one of 5 per rolling 24 hours, checked on the server under the `users` row lock (ARCHITECTURE.md section 6, "Generation is explicit"). On the client `apps/mobile/src/features/today/queue-rule-10.spec.ts` allows the generate mutations only in the queries module and in screen/menu components (a text scan: it cannot see an effect inside a component, so review those by eye).

### Security rules

1. Provider keys (Anthropic, TTS, Supabase service role, database URL) exist only on the server: Secret Manager in production, a git-ignored env file locally. They never appear in `apps/mobile`, `packages/contracts`, logs, prompts or error responses. The mobile app holds only the Supabase URL and publishable key.
2. The API trusts only the user id from a verified Supabase JWT. Never take a user id, role or ownership from the request body, query or headers. Every query on user data is scoped by that id.
3. Every table has RLS enabled and no policies. The mobile app never queries Supabase tables directly. Storage buckets are private, and the app only receives short-lived signed URLs from the API.
4. Every `/internal/*` endpoint verifies a Google OIDC token with the expected audience and service account before doing anything. A user JWT is not accepted there. (The one development-only exception, `JOB_QUEUE=local`, is described in SECURITY.md rule 4 and ARCHITECTURE.md section 11, item 7; it is refused in production and on Cloud Run.)
5. All data crossing a boundary goes through a Zod schema from `packages/contracts`: request bodies, response bodies and structured LLM output. No `any` at a boundary.
6. Microphone audio never leaves the device. No upload, no cloud speech-to-text, no network call on the audio path.
7. User-written topic text is untrusted data. It is never concatenated into system instructions. LLM output is treated as plain text and is never executed or used to choose tools, URLs or code paths.
8. The database stores storage object paths, never signed URLs. Signed URLs are short-lived and created per request.
9. No secrets, tokens, email addresses or story text in logs.
10. Text a person typed (a requested topic, a custom interest) and everything generated from it is never shown to anyone else. Stories are reused between people only when their topic was proposed by the system (no `user_topics` row for it has the reason `requested`).

## Where code goes

This is the target layout. Create folders when first needed, not before.

| What | Where |
|---|---|
| Screens, navigation, hooks, stores | `apps/mobile/src` |
| Nest modules, one per feature | `apps/api/src/app/<feature>` |
| Prisma schema and migrations | `apps/api/prisma` |
| Local Supabase stack configuration (`config.toml`; the Supabase CLI keeps its own state next to it) | `apps/api/supabase` |
| Generated Prisma client (git-ignored, never edited by hand) | `apps/api/src/generated/prisma` |
| LLM, TTS and storage adapters | `apps/api/src/app/providers` |
| Cloud Tasks and Scheduler handlers | `apps/api/src/app/internal` |
| Prompts | `apps/api/src/app/generation/prompts` |
| Zod schemas and shared types | `packages/contracts/src` |
| Subagents, the `/feature` command and the agent brief | `.claude/agents`, `.claude/commands`, `.claude/agent-brief.md` |
| gcloud infrastructure scripts and the production runbook | `infra/` |
| Android release scripts and the local release runbook (the release key lives outside the repository, in `~/sleep-stories-keys`) | `apps/mobile/release` |
| Screen designs from Claude Design (git-ignored, local only; the source of truth for every screen) | `design/` |

## Conventions

- Language: code, comments, commit messages and documentation are in English. User-facing copy is in Russian.
- TypeScript in strict mode. No `any` at boundaries.
- Run tasks through Nx with the package manager prefix (`npx nx ...`), never the underlying tool directly. Never guess a flag: check `--help` first.
- Before writing setup code for any dependency, check its current documentation. Library setup changes between major versions, and your memory of it is older than the library. Pin exact versions. Prefer a release at least two weeks old.
- Record the reason next to any non-obvious choice: what it buys and what it costs.
- Nothing is done because it looks right. A command that returns pass or fail, with its real output, is the only evidence.
- Do not commit unless the owner asks. Commit types: `chore` (scaffolding, tooling, dependencies, configuration; workspace setup is always `chore`), `feat` (functionality and anything that changes behaviour), `docs`, `build` (CI, containers, deployment), `refactor` (structure changes with no behavioural difference).
- When a rule is claimed to be enforced by tooling, prove it by breaking it on purpose (add the forbidden import, confirm lint fails, remove it).

## Slices and reviewability

The owner works alone and must stay the owner of the architecture: every change has to be readable and understood before it is committed. Speed comes from small slices, not from big diffs. These rules apply in every mode (`lite`, `standard`, `full`). Only a typo, a one-line config edit or a rename skips them.

**Size of a slice**
1. Split every feature into vertical slices (for example data, then API, then UI). Never build a feature in one pass.
2. Target: up to 8 significant files per slice. Ceiling: 10 to 12 significant files or about 400 changed lines of logic.
3. The real test is "the owner can read the change in one sitting"; the numbers approximate it. The ceiling gives room so that a whole feature is not split because of an 11th file.
4. Not counted: style files, pure boilerplate, generated files, the lockfile, snapshots, mass trivial renames or prop threading, tests (name them in the report), and `.md` documents. Always counted: migrations and every core file.
5. Over the ceiling: stop and cut BEFORE writing code, or say why it cannot be cut and ask the owner.
6. Cut along meaning, not by count. Every slice leaves the project working: typecheck and the unit tests of the affected projects pass. No mechanical "10 files here, the rest in the next commit" when that breaks a whole.

**Plan before code**
7. Before any non-trivial feature write no code. List the files to touch, one line each: what changes and why, marked `core` or `boilerplate`. Boilerplate files of one kind may share a line. If the significant files exceed the ceiling, cut the plan into slices and propose their order. The owner approves the plan before generation starts.

**Review by meaning**
8. After each slice, report to the owner in Russian: what was, what is now, why; the order to read the change in; the 1 to 3 files that hold logic or risk; the files that can be skimmed in the diff. Lead the owner to those files; do not ask them to open everything.
9. Zones. Core: slow down, smaller slices, explain in detail, the owner reads line by line and does not accept what they do not understand. Boilerplate: a short diff and a minimal review. The core zone is the planner's `high` tier; boilerplate is `low`; `medium` follows the numbers above.

**Commits**
10. One finished slice is one commit with a clear message, never a mix of unrelated changes, so that a slice can be reverted whole and cheaply. The documentation changes that belong to the slice (ARCHITECTURE.md, MAP.md and the like) go into the same commit. A `docs` commit is for documentation not tied to code. Commit types stay as in Conventions.
11. Commits are still made by the owner. If the owner writes "commit the slices yourself" in the request, the executor commits each slice after its checks pass and the report is written; otherwise it stops after each slice and waits.

**Core zone (owner-approved 2026-11-05; change it only with the owner)**
- Data: `apps/api/prisma/**` (schema, migrations, RLS, seed).
- Access and keys: `apps/api/src/app/auth/**`, `config/**`, `providers/**`, `internal/**`, `users/**`, `me/**`.
- Money and generation: everything that creates `write_story` or `render_audio` jobs or counts the limit of 5 per 24 hours (`queue/generation-start*`, `queue/generation-limits*`, `queue/generation-jobs*`, `prisma/lock-user-row.ts`, `generation/**` with the prompts); on the client, the generate, collect and rebuild mutations.
- Contracts: `packages/contracts/src/**` (the specs excluded).
- Guard tests: `architecture.spec.ts`, `queue-rule-10.spec.ts`, the boundary rules in `eslint.config.mjs`.
- Session on the device: `apps/mobile/src/features/auth/**` and the auth header in `apps/mobile/src/api`.
- The night player's logic: `apps/mobile/src/features/player/night-engine.ts` and `player-machine.ts` (state that is hard to debug without a phone).
- Dependencies and native build: a new dependency in `package.json`, `apps/mobile/app.json`, `apps/mobile/eas.json`.
- The rules themselves: `AGENTS.md`, `ARCHITECTURE.md`, `SECURITY.md`, `MAP.md`, `.claude/**`.

Boilerplate is everything visible on screen and cheap to fix: `apps/mobile/src/ui`, `theme`, `strings.ts`, screen layout, plain presentational components, configuration with no effect on data or access.

**The project map**
12. `MAP.md` is the owner's text map: modules, invariants, key decisions and why. It points to ARCHITECTURE.md; it does not copy it. Invariants are named by their rule numbers here, not restated.
13. Update `MAP.md` only when a new module or boundary appears, an invariant is added, or an architectural decision is made or changed. Not after every feature and not for details visible in the code. Every report on a slice says "MAP.md: update needed, yes or no, and why".
14. Keep `MAP.md` at or below 180 lines. Delete what is out of date instead of piling it up. Detail lives in ARCHITECTURE.md sections that `MAP.md` links to. If the map grows too fast or passes 180 lines, tell the owner and propose to compress or split it.

## Commands

```sh
npx nx serve api            # API at http://localhost:3000/api
npx nx build api
npx nx lint api
npx nx typecheck api        # build, lint, typecheck and test run prisma-generate first
npx nx prisma-generate api  # regenerate the Prisma client (git-ignored)
npx nx prisma-migrate-dev api -- --create-only --name <name>   # create a migration without applying it
npx nx prisma-migrate-dev api -- --name <name>                 # create and apply a migration
npx nx prisma-migrate-deploy api
npx nx prisma-migrate-status api
npx nx supabase-start api   # local Supabase stack in Docker (Postgres on 54322, API on 54321, Studio on 54323)
npx nx supabase-stop api    # stop it after work: its ports are open on every network interface
npx nx supabase-status api --outputStyle=static   # status (text by default, `-o json` for JSON); it contains local keys, do not paste it anywhere
npx nx docker-build api      # build the API image (apps/api/Dockerfile, context = repo root) as sleep-stories-api:local
npx nx docker-smoke api      # build it and prove it in containers; needs Docker and the local Supabase stack running
npx nx start mobile         # Metro bundler (Expo)
npx nx lint mobile
npx nx typecheck mobile
npx nx run-android mobile   # needs Android Studio
npx nx build mobile --platform=android --profile=preview   # EAS cloud build, installable APK; fallback only, the default is the local build below; run from the repo root
bash apps/mobile/release/create-key.sh     # once: make the Android release key in ~/sleep-stories-keys (outside the repository; back it up)
bash apps/mobile/release/build-release.sh   # a release APK, built and signed on this Mac (EAS stays a fallback); then `verify-apk.sh <apk>`; runbook: apps/mobile/release/README.md
bash apps/mobile/release/check.sh          # offline check of the release scripts (no network, never touches the real key)
bash infra/check.sh                     # offline check of the Google Cloud scripts (no login, no gcloud call)
DRY_RUN=1 bash infra/bootstrap.sh       # print the Google Cloud commands without running them; `bash infra/set-secret.sh NAME` stores one secret from the terminal
DRY_RUN=1 bash infra/push-image.sh      # then, in order: `bash infra/push-image.sh`, `bash infra/deploy.sh <tag>`, `bash infra/smoke.sh basic|sweep` (live checks), `ALERT_EMAIL=<address> bash infra/alerts.sh` (alerts and a budget; the owner's own address, taken from the environment or a prompt, never printed or committed, but visible in gcloud's argument list and its local log file); every one takes DRY_RUN=1 first, the order is in infra/README.md
```

The `gcloud` scripts in `infra/` (runbook: `infra/README.md`) call `gcloud` only through one wrapper that adds `--project`, because the default project on the owner's Mac is another one. `gcloud` 564 there runs on Python 3.9 and cannot load the `run` commands: `export CLOUDSDK_PYTHON=<a Python 3.10+ path>` first (for example from `uv python find 3.12`; the path is machine-specific and goes into no file).

EAS builds, learned the hard way (ARCHITECTURE.md section 11, item 22):
- Start them only through `npx nx build mobile ...` from the repository root. The Nx executor copies the root `package.json` and lockfile into `apps/mobile` for the build; `eas build` run inside `apps/mobile` fails with "No lockfile found". Add `--interactive=false --wait=false` to start a build and return at once; the first build on an account asks to generate a keystore, which needs an interactive terminal.
- The executor leaves a stray `"devDependencies": {}` and no trailing newline in `apps/mobile/package.json`. Restore it (`git checkout apps/mobile/package.json`, or re-apply your own change) before committing. `npx nx install mobile ...` is worse: it adds a list of unrelated packages to the same file and can create a stray `app.json` in the repository root. Check `git status` after either.
- Every profile in `apps/mobile/eas.json` pins Node 24.19.0. Without it EAS uses npm 10 and `npm ci` rejects the npm 11 lockfile. EAS logs are Brotli-compressed; decode them with Node's `zlib.brotliDecompressSync`.
- Local Android builds work on the owner's Mac (checked 2026-11-03/04): Android Studio with SDK 36 and JDK 21 (its bundled JBR) is installed. After `npx nx prebuild mobile --platform=android --install=false`, a debug APK for one architecture builds in about 3.5 minutes (`apps/mobile/android` is git-ignored):
  ```sh
  cd apps/mobile/android && export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH" && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
  ```
  The APK is `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. It contains the dev launcher (`expo-dev-client`): open it, then type the Metro address (`http://<LAN address>:19000`) or scan the QR that `npx nx start mobile` prints. A plain debug build looks for `localhost:8081` and hangs on the splash screen. A release build cannot be used for local testing: Android blocks cleartext `http` to the Metro server. Local builds are the default for every Android build, release builds included (owner, 2026-11-06: an EAS build sat in the queue for an hour and then built for half an hour); EAS cloud builds are a fallback only. The app is Android-only and is installed from an APK (ARCHITECTURE.md section 12); iOS is impossible without the Xcode app and is not planned. `npx nx prebuild mobile --platform=all --install=false` is a quick check of `app.json` and plugins. Generated `apps/mobile/ios` and `apps/mobile/android` are git-ignored.
- JavaScript timers do not fire while an Android app is in the background; native player events do. Do not time anything for the screen-off case with `setTimeout` (ARCHITECTURE.md section 7).

Database setup: local is the default. Start the stack with `npx nx supabase-start api` and apply the schema with `npx nx prisma-migrate-deploy api`. In `apps/api/.env` the two cloud lines are commented out (prefix `# cloud: `) and the local ones are active (host `127.0.0.1`, port 54322, plus `DATABASE_TLS` and `SUPABASE_URL`, both read by the API). Never print `.env`: it still holds the cloud password. The Supabase CLI is the npm package `supabase`, a pinned root dev dependency (the version is in the lockfile); do not install it with Homebrew (see Current state). Nx hides the output of a successful task for an agent, so add `--outputStyle=static` to see it. A new `apps/api/.env` is made by copying `apps/api/.env.example` (the local block is active, the cloud lines carry the `# cloud: ` prefix). To use the cloud project, comment out the local block, remove the `# cloud: ` prefix from the two cloud lines and fill in the real values: `DATABASE_URL` (Supabase transaction pooler, port 6543, used by the running API) and `DIRECT_URL` (Supabase session pooler, port 5432, used only by the Prisma CLI). Exactly one definition of each key may be active; switch back to local afterwards. Never print or commit `.env`. The `prisma-*` targets pass extra arguments after `--`. `build`, `lint`, `typecheck` and `test` of `api` depend on `prisma-generate`, so they need `DIRECT_URL` set even though they do not touch the database. `serve` depends on `build`, so `npx nx serve api` also regenerates the client after a schema change (checked); running `prisma` directly in `apps/api` does not. Never use `prisma db push`; migrations are the only way the schema changes.

`npx nx test api` and `npx nx test mobile` run the unit tests (Jest; the Expo-backed code cannot be tested without a device). `npx nx test-integration api` runs the `*.int-spec.ts` tests against the local database and needs the local stack and the migrated schema. `npx nx prisma-seed api` loads the four ElevenLabs voices and the placeholder interests. `npx nx test contracts` tests the shared schemas. To test the app on a phone: start the stack, migrate, seed, `npx nx serve api`, `npx nx start mobile` (Metro on port 19000), and put the Mac's LAN address in the git-ignored `apps/mobile/.env` (copy `apps/mobile/.env.example`).

## Current state

- `apps/api` is a NestJS app with a global `PrismaModule`/`PrismaService` (Prisma 7 with `@prisma/adapter-pg`), Zod-validated environment configuration that fails at boot, a global Supabase JWT guard (`jose`), `GET /api/me`, `PUT /api/me/onboarding`, `GET /api/interests` and `GET /api/voices` (returns short-lived signed sample URLs made by the storage adapter in `apps/api/src/app/providers/storage`). `apps/mobile` is an Expo Router app on Expo SDK 57 (`expo` 57.0.25, React Native 0.86.3), linked to an EAS project (`owner` `antoxa-org`, slug `mobile`), with email sign-up and sign-in, an encrypted persistent session, a three-step onboarding and the screen «Сегодня» (cycle 5, 2026-10-31: greeting, main button with caption, the night queue with reorder by a handle, swipe to remove, item menu and hint sheet, empty states, toasts, a bottom bar that always stays (a Tabs navigator: «Сегодня» and «Темы» are tabs that keep their state, «Замена» is a stack screen above them with no bar; «Настройки» is a third tab); the empty queue offers «Собрать подборку», which calls `POST /api/queue/collect` (a topic suggestion only, never a story job; the server reports `collecting` in the queue answer), and «Выбрать истории», which opens «Темы»; «Настройки» is a temporary screen with one «Выйти» button, a test aid until the real settings screen exists). Since 2026-11-03 heard stories are marked on «Сегодня», «Темы» and «Замена» (muted title, «✓ Прослушана»), «Темы» and «Замена» have two filter chips («Готовность», «Прослушивание») that open single-choice sheets and filter on the server (`ready=`, `heard=`), and the queue header has a ⋯ button with the sheet «Очередь на ночь» («Добавить истории», «Пересобрать очередь» → `POST /api/queue/rebuild`, on a tap only, no undo; the client rule 10 spec has a `REBUILD` pattern). The main button counts and plays every ready item of the queue, heard ones included (owner, 2026-11-03). None of this has been seen on a device (ARCHITECTURE.md section 7, "Heard stories, the filters…"); the player still has comments and one queue re-read written for the old behaviour in which a listen removed the queue item (the player cycle will clean them up). It uses `react-native-gesture-handler` 2.32.0, `react-native-reanimated` 4.5.1, `react-native-worklets` 0.10.1 and `react-native-reorderable-list` 0.18.1 (ARCHITECTURE.md section 7, "Lists"). Swipe, drag and sheets are not checked on a device yet. `packages/contracts` (`@sleep-stories/contracts`) holds the shared Zod schemas. Checked end to end on an Android phone in Expo Go SDK 57 on 2026-10-30.
- The three job handlers (`suggest_topics`, `write_story`, `render_audio`; `apps/api/src/app/internal/handlers`) are registered, and completing onboarding triggers the queue top-up after its transaction commits (errors swallowed with a fixed log line). With `JOB_QUEUE=local` the pipeline runs end to end on a laptop: onboarding, suggestion (two model calls, so typed interests never reach another person), stories, audio. `internal/generation-e2e.int-spec.ts` proves it with fake providers. Not yet checked with the real providers: that is one manual run by the owner (cycle 3b-2 plan, "Verification"). Verified live by the owner on a phone with real providers (`JOB_QUEUE=local`, local Supabase stack) on 2026-10-31: after onboarding every entity was generated (topics, stories, audio, queue items). **That behaviour was removed on 2026-10-31:** the owner decided that generation is explicit (architecture rule 10; ARCHITECTURE.md section 6, "Generation is explicit"). Now only `suggest_topics` is automatic: after onboarding the queue holds three items, none ready, and no `write_story` or `render_audio` row exists (`generation-e2e.int-spec.ts` proves it, and proves that a `write_story` job created in the test still chains into a render). The handlers `write_story` and `render_audio` are unchanged and wait for an explicit start. The explicit start (cycle 4c, 2026-10-31) is built: `POST /api/queue/generate` and `POST /api/queue/items/:itemId/generate` in `apps/api/src/app/queue` create the story jobs under the `users` row lock, all-or-nothing within 5 generations per rolling 24 hours. The queue can be read, edited (`DELETE /api/queue/items/:itemId`, `PUT /api/queue/order`) and started through the API (cycles 4a and 4c; ARCHITECTURE.md section 6, "The user-facing queue API"). The screens «Темы» (check a topic to add it to the queue, uncheck to remove it) and «Замена» (replace a queue item with another topic) are built on top of that API (2026-10-31); like the rest they are not checked on a device yet. The stories player is built (2026-11-01; `apps/mobile/src/features/player`, route `app/(app)/player.tsx`; ARCHITECTURE.md section 7, "The stories player"): the main button on «Сегодня» opens it; modes playing, dimmed, waves, waves-dimmed and asleep; `expo-audio` streaming the signed URLs; `expo-keep-awake`; the bundled `apps/mobile/assets/audio/waves.mp3`; a listen report per story and a tap during the waves that continues the night; a draggable time bar on `@react-native-community/slider` 5.2.0 (owner-approved 2026-11-03, replacing a hand-made bar), a clickable «Дальше» card, a previous rule (more than 3 s restarts), 3-second silences from a bundled `silence-3s.wav`, and the dimmed and asleep looks as fading layers over a player screen that never remounts. The `expo-audio` config plugin is in `app.json` (background playback on, microphone off) and each story player is the lock-screen player (play/pause and a scrub bar; owner, 2026-11-03; ARCHITECTURE.md section 7, "The lock screen"); continuing the night from the lock screen stays deferred. Like the rest it is not checked on a device, and the lock screen needs an EAS build, not Expo Go. Not built yet on the phone: settings, ratings, a history of listens and the typed-topics field («Расскажи про…»).
- The 14-table schema and its first migration (`init`, with RLS on every table and `_prisma_migrations`, CHECK constraints and a partial unique index) are in `apps/api/prisma`. The migration `drop_voice_asleep_prompt_audio_path` followed it. Both are applied to the local stack; the cloud development database is one migration behind (`prisma-migrate-deploy` when switching back). The seed (`prisma-seed`) provides the four real ElevenLabs voices (`maxim`, `anna`, `lev`, `kate`; sample audio paths are `voices/<slug>/sample.mp3` inside the private Supabase bucket `audio`; no TTS SDK is installed yet) and ten placeholder interests.
- The local Supabase stack (Supabase CLI 2.121.0, npm devDependency) runs in Docker and holds a copy of the schema; `apps/api/.env` points at it. The API boots against it (`DATABASE_TLS=disabled-local-only` is honoured only for a loopback host outside production and Cloud Run). Homebrew formula installs do not work on the owner's Mac: its Command Line Tools are too old for macOS 27 (observed on 2026-10-29), which is why the CLI comes from npm.
- The LLM and TTS adapters (`apps/api/src/app/providers/llm`, `tts`), `StorageService.uploadAudio` and three database-free services (`apps/api/src/app/generation`: topic suggester, story writer, audio renderer) exist. The API now needs `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` in `apps/api/.env` to boot. Nothing calls them yet except the opt-in paid smoke spec `generation-smoke.int-spec.ts` (`RUN_PAID_SMOKE=1`), which costs a few cents. It passed end to end on 2026-10-30 (story, audio, upload, signed URL that plays); ElevenLabs text-to-speech through the API needs a paid plan.
- `QueueTopUpService` (`apps/api/src/app/queue`) decides what goes into a person's queue. Since 2026-10-31 it only fills the queue and creates `suggest_topics` jobs, within 5 suggestions per rolling 24 hours; it creates no story or audio job, and every such job comes from an explicit start (ARCHITECTURE.md section 6). `GenerationLimitsService` counts generations (5 per rolling 24 hours); `GenerationStartService` spends them. Onboarding calls it after its transaction commits; so do `POST /api/queue/collect` and `POST /api/queue/continue`, both on a tap.
- The job executor is built (cycle 3b-1): `POST /api/internal/jobs/run` and `/sweep` in `apps/api/src/app/internal`, guarded by `@InternalRoute()` (Google OIDC in production, a per-boot local secret with `JOB_QUEUE=local`), a claim with a 10-minute lease and a fence, attempts 3/2/2, a failure policy under which a finally failed job becomes `failed`, frees its slot and removes nothing from any queue (owner, 2026-10-31: the item stays and shows the failed state), and `LocalJobQueue` for development (`JOB_QUEUE=local` posts to the API itself; the single dev-only exception to the no-background-work rule). The three handlers are registered (cycle 3b-2). `JOB_QUEUE=cloud-tasks` is built (2026-11-06): `CloudTasksJobQueue` (`apps/api/src/app/providers/job-queue`) creates one unnamed Cloud Task per job through `@google-cloud/tasks` 7.3.0 (REST, no SDK retries, 10 s timeout, imported in that file only), and needs `GCP_PROJECT_ID`, `CLOUD_TASKS_LOCATION` and `CLOUD_TASKS_QUEUE` besides the two OIDC variables; it is proven with a fake client and by the container smoke test, not yet against real Google. The Cloud Tasks queue itself, the Cloud Scheduler job and the production deployment are still missing.
- The user-facing queue API is built (cycles 4a, 4b, 4c; ARCHITECTURE.md section 6): `GET /api/queue`, delete, reorder, the explicit start, `GET /api/topics`, and add, replace and «Другая история» (`QueuePickService`, `TopicsService`). Two routes serve the player (2026-11-01): `POST /api/listens` only records one listen per story (server time, skipped below 10 s, clamped to the audio duration plus 5 s; since 2026-11-03 it no longer removes the queue item or renumbers: the queue changes only by the person's own actions) and `POST /api/queue/continue` (the tap during the waves) replaces the queue with up to 3 ready, unheard stories, newest first, or, if none exist, only tops the queue up (`suggest_topics`, never a story job) and answers `none_ready`; it deletes every item it replaces, failed ones included. `POST /api/queue/rebuild` («Пересобрать очередь», 2026-11-03, `QueueRebuildService`) deletes the whole queue and inserts up to 3 unheard stories (ready, then without audio, then the person's own topics without a story), then tops up (`suggest_topics` only); no undo. Queue items and topic rows carry a derived `heard` flag (one listen of at least 90 % of the audio, `LISTEN_FINISHED_SHARE`; SQL in `queue/heard.ts`); `GET /api/topics` lists heard topics last and has a `heard` filter; add and replace may take a heard topic, «Другая история» and every automatic choice never do. No route creates a story job except the explicit start. `lockUserRow` (`apps/api/src/app/prisma/lock-user-row.ts`) is the only place that locks the `users` row, and `apps/api/src/app/architecture.spec.ts` fails if a story job payload or that lock is written elsewhere.
- The API image exists (2026-11-06): `apps/api/Dockerfile` (Node 24.19.0, non-root, `node main.js`), `apps/api/package.json` (names `@prisma/client`, `pg` and `tslib` for the built manifest; ARCHITECTURE.md section 11, item 19), shutdown hooks and an explicit pool of 10. `npx nx docker-smoke api` proves it against the local stack; it has not run on Cloud Run.
- The Android release scripts exist in `apps/mobile/release` (2026-11-07): `create-key.sh`, `build-release.sh`, `verify-apk.sh`, `check.sh`, with a runbook in its `README.md`. They passed their offline check and one real build with a throwaway key; the owner has not yet made the real key or the real APK, and no release has been installed on a phone.
- Not created yet: CI, password reset, email confirmation (sign-up reveals whether an address is registered until it is on; SECURITY.md), Google sign-in, the Cloud Tasks queue and Scheduler, the typed-topics field («Расскажи про…»). The deployment scripts in `infra/` (foundation, image, deploy, live checks, alerts and a budget; runbook `infra/README.md`) are written and pass the offline `infra/check.sh`. The owner ran the runbook on 2026-11-07 and reports that the deployment and its tests work; the RESULT blocks of that run are not recorded in the repository, and no SECURITY.md checklist item is ticked yet. The deployment itself (Cloud Run, the queue, the Scheduler job) exists since that day.
- The root package is `@sleep-stories/source`. `app.json` holds the bundle identifier and Android package `com.antoxa566.sleepstories` (owner, 2026-11-06; ARCHITECTURE.md section 11, item 11 and section 12).
- The background-audio spike (open problem 1) was run on one Android phone and stopped early by the owner. Its code is on the branch `spike/background-audio` and is not to be merged. What it found, and the decisions that followed, are recorded in ARCHITECTURE.md sections 7, 10 and 11: no microphone, a touch continues the night, the screen stays on and dims. `expo-audio` 57.0.5 is installed (owner, 2026-10-30) for the foreground voice sample in onboarding; the stories player plays with it too, but which library the player keeps in the long run (with `react-native-track-player` as the alternative) stays the owner's choice; the lock-screen control is built on `expo-audio` (2026-11-03). `expo-keep-awake` 57.0.2 is installed for the player, and `@react-native-community/slider` 5.2.0 for its time bar (owner, 2026-11-03).

## The development cycle

Non-trivial work runs through subagents in `.claude/agents/`, driven by the `/feature` command. Tokens are scarce (100k tokens is about 10% of the owner's five-hour limit), so the cycle has three modes and hard limits:

- `lite`: `planner`, `executor`, one final check pass. No review. For UI, copy, small screens, config.
- `standard` (default): the same, plus ONE scoped `reviewer` pass at the end, on the risky files only. For most features.
- `full`: standard plus an `architect` sign-off. For a new module or table, a new dependency, a boundary change, or work centred on auth, keys or data access. Planner and reviewer run on Opus here, on Sonnet otherwise.

How it runs:

1. `planner` (read-only) returns a plan cut into slices ("Slices and reviewability"): per slice a table of files with what and why and `core` or `boilerplate`, a risk tier, the checks, the flags and a mode recommendation with a rough token cost. A person approves it before any file is touched.
2. `executor` (the only agent that writes) implements one slice at a time with a fast check after each step (typecheck and the unit test of what changed). At the end of a slice it runs typecheck and test of the affected projects, measures the slice (`git diff --numstat` minus the uncounted files), writes the report for the owner and stops (or commits, if the owner allowed it). The full pass (lint, typecheck, test, plus build and integration tests when the API changed) runs once, at the last slice of the feature, and also in any slice that touches a migration. Steps marked independent may run in parallel in the same working tree, in separate directories (no git worktrees: they lack `node_modules` and the git-ignored env files).
3. `reviewer` (read-only, fresh context) reads the listed files only, runs no `nx`, reports at most 8 findings and ends with `VERDICT: APPROVED` or `VERDICT: CHANGES_REQUESTED`. At most two rounds; the second looks only at the fixes.
4. `architect` (read-only, full mode only) checks structural fit once, with the same verdict format. No loop.
5. The final report carries a token table (one row per subagent run) so the cost of the cycle is visible, and the "MAP.md: update needed" line.

Every agent starts from `.claude/agent-brief.md`: the rules in one line each, a map of ARCHITECTURE.md by section, and the output rules below. It replaces reading AGENTS.md, ARCHITECTURE.md and SECURITY.md whole (about 22k tokens). When a rule here changes, change the matching line in the brief. A person makes the commit. Small changes (a typo, a one-line config edit, a rename) skip the cycle.

### Output discipline (for every agent and for the main session)

- Never print a whole file, a long log or a whole diff. Use `grep`, `sed -n`, `head`, `tail`, `git diff --stat`.
- Filter Nx output to its result lines. Do not add `--skip-nx-cache` unless a cached result is suspect.
- Run the full check pass once at the end of a feature, not after every step. After each slice only typecheck and test of the affected projects.
- A native Expo module's behaviour is checked against its native source as well as its types (the `expo-crypto` case, ARCHITECTURE.md section 8).

Many tools write their own managed block into this file. Write above it, never inside it, and never remove the markers.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
