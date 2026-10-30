# Sleep Stories: guide for coding agents

Sleep Stories is a mobile app that plays a queue of short, AI-generated Russian-language stories so a person can fall asleep to them. Stack: Nx monorepo (npm), Expo (React Native) app, NestJS API on Google Cloud Run, Supabase (Postgres, Auth, Storage) with Prisma, Cloud Tasks for background jobs.

## Read first

- `ARCHITECTURE.md`: boundaries, data model, every decision with its reasoning, what is deferred or rejected, and the open problems. It records why, not only what. Use its reasoning instead of deriving your own.
- `SECURITY.md`: threat model and the pre-launch checklist. Read it whenever a change touches keys, auth, data access, storage, internal endpoints, prompts or the microphone.
- `design/`: the screen designs, exported from Claude Design. Read the matching design before building or changing any screen. The folder is git-ignored and exists only on the owner's machine: if it is missing, ask the owner, and never invent a design or copy files from it into the repository.

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

### Security rules

1. Provider keys (Anthropic, TTS, Supabase service role, database URL) exist only on the server: Secret Manager in production, a git-ignored env file locally. They never appear in `apps/mobile`, `packages/contracts`, logs, prompts or error responses. The mobile app holds only the Supabase URL and publishable key.
2. The API trusts only the user id from a verified Supabase JWT. Never take a user id, role or ownership from the request body, query or headers. Every query on user data is scoped by that id.
3. Every table has RLS enabled and no policies. The mobile app never queries Supabase tables directly. Storage buckets are private, and the app only receives short-lived signed URLs from the API.
4. Every `/internal/*` endpoint verifies a Google OIDC token with the expected audience and service account before doing anything. A user JWT is not accepted there.
5. All data crossing a boundary goes through a Zod schema from `packages/contracts`: request bodies, response bodies and structured LLM output. No `any` at a boundary.
6. Microphone audio never leaves the device. No upload, no cloud speech-to-text, no network call on the audio path.
7. User-written topic text is untrusted data. It is never concatenated into system instructions. LLM output is treated as plain text and is never executed or used to choose tools, URLs or code paths.
8. The database stores storage object paths, never signed URLs. Signed URLs are short-lived and created per request.
9. No secrets, tokens, email addresses or story text in logs.

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
npx nx start mobile         # Metro bundler (Expo)
npx nx lint mobile
npx nx typecheck mobile
npx nx run-ios mobile       # needs Xcode
npx nx run-android mobile   # needs Android Studio
npx nx build mobile --platform=android --profile=preview   # EAS cloud build, installable APK; run from the repo root
```

EAS builds, learned the hard way (ARCHITECTURE.md section 11, item 22):
- Start them only through `npx nx build mobile ...` from the repository root. The Nx executor copies the root `package.json` and lockfile into `apps/mobile` for the build; `eas build` run inside `apps/mobile` fails with "No lockfile found". Add `--interactive=false --wait=false` to start a build and return at once; the first build on an account asks to generate a keystore, which needs an interactive terminal.
- The executor leaves a stray `"devDependencies": {}` and no trailing newline in `apps/mobile/package.json`. Restore it (`git checkout apps/mobile/package.json`, or re-apply your own change) before committing. `npx nx install mobile ...` is worse: it adds a list of unrelated packages to the same file and can create a stray `app.json` in the repository root. Check `git status` after either.
- Every profile in `apps/mobile/eas.json` pins Node 24.19.0. Without it EAS uses npm 10 and `npm ci` rejects the npm 11 lockfile. EAS logs are Brotli-compressed; decode them with Node's `zlib.brotliDecompressSync`.
- Native builds cannot be made on the owner's Mac (checked 2026-10-09: only the Command Line Tools, no Xcode app, no JDK); use EAS. `npx nx prebuild mobile --platform=all --install=false` works there and is a quick check of `app.json` and plugins. Generated `apps/mobile/ios` and `apps/mobile/android` are git-ignored.
- JavaScript timers do not fire while an Android app is in the background; native player events do. Do not time anything for the screen-off case with `setTimeout` (ARCHITECTURE.md section 7).

Database setup: local is the default. Start the stack with `npx nx supabase-start api` and apply the schema with `npx nx prisma-migrate-deploy api`. In `apps/api/.env` the two cloud lines are commented out (prefix `# cloud: `) and the local ones are active (host `127.0.0.1`, port 54322, plus `DATABASE_TLS` and `SUPABASE_URL`, both read by the API). Never print `.env`: it still holds the cloud password. The Supabase CLI is the npm package `supabase`, a pinned root dev dependency (the version is in the lockfile); do not install it with Homebrew (see Current state). Nx hides the output of a successful task for an agent, so add `--outputStyle=static` to see it. A new `apps/api/.env` is made by copying `apps/api/.env.example` (the local block is active, the cloud lines carry the `# cloud: ` prefix). To use the cloud project, comment out the local block, remove the `# cloud: ` prefix from the two cloud lines and fill in the real values: `DATABASE_URL` (Supabase transaction pooler, port 6543, used by the running API) and `DIRECT_URL` (Supabase session pooler, port 5432, used only by the Prisma CLI). Exactly one definition of each key may be active; switch back to local afterwards. Never print or commit `.env`. The `prisma-*` targets pass extra arguments after `--`. `build`, `lint`, `typecheck` and `test` of `api` depend on `prisma-generate`, so they need `DIRECT_URL` set even though they do not touch the database. `serve` depends on `build`, so `npx nx serve api` also regenerates the client after a schema change (checked); running `prisma` directly in `apps/api` does not. Never use `prisma db push`; migrations are the only way the schema changes.

`npx nx test api` and `npx nx test mobile` run the unit tests (Jest; the Expo-backed code cannot be tested without a device). `npx nx test-integration api` runs the `*.int-spec.ts` tests against the local database and needs the local stack and the migrated schema. `npx nx prisma-seed api` loads the four ElevenLabs voices and the placeholder interests. `npx nx test contracts` tests the shared schemas. To test the app on a phone: start the stack, migrate, seed, `npx nx serve api`, `npx nx start mobile` (Metro on port 19000), and put the Mac's LAN address in the git-ignored `apps/mobile/.env` (copy `apps/mobile/.env.example`).

## Current state

- `apps/api` is a NestJS app with a global `PrismaModule`/`PrismaService` (Prisma 7 with `@prisma/adapter-pg`), Zod-validated environment configuration that fails at boot, a global Supabase JWT guard (`jose`), `GET /api/me`, `PUT /api/me/onboarding`, `GET /api/interests` and `GET /api/voices` (returns short-lived signed sample URLs made by the storage adapter in `apps/api/src/app/providers/storage`). `apps/mobile` is an Expo Router app on Expo SDK 57 (`expo` 57.0.25, React Native 0.86.3), linked to an EAS project (`owner` `antoxa-org`, slug `mobile`), with email sign-up and sign-in, an encrypted persistent session, a three-step onboarding and a placeholder Home with logout. `packages/contracts` (`@sleep-stories/contracts`) holds the shared Zod schemas. Checked end to end on an Android phone in Expo Go SDK 57 on 2026-10-30.
- The 14-table schema and its first migration (`init`, with RLS on every table and `_prisma_migrations`, CHECK constraints and a partial unique index) are in `apps/api/prisma`. The migration `drop_voice_asleep_prompt_audio_path` followed it. Both are applied to the local stack; the cloud development database is one migration behind (`prisma-migrate-deploy` when switching back). The seed (`prisma-seed`) provides the four real ElevenLabs voices (`maxim`, `anna`, `lev`, `kate`; sample audio paths are `voices/<slug>/sample.mp3` inside the private Supabase bucket `audio`; no TTS SDK is installed yet) and ten placeholder interests.
- The local Supabase stack (Supabase CLI 2.121.0, npm devDependency) runs in Docker and holds a copy of the schema; `apps/api/.env` points at it. The API boots against it (`DATABASE_TLS=disabled-local-only` is honoured only for a loopback host outside production and Cloud Run). Homebrew formula installs do not work on the owner's Mac: its Command Line Tools are too old for macOS 27 (observed on 2026-10-29), which is why the CLI comes from npm.
- Not created yet: any deployment, CI, password reset, email confirmation (sign-up reveals whether an address is registered until it is on; SECURITY.md), Apple and Google sign-in, audio, story generation.
- The root package is `@sleep-stories/source`. `app.json` holds the bundle identifier and Android package `com.antoxa566.mobile`; it is not confirmed as final (ARCHITECTURE.md section 11, item 11).
- The background-audio spike (open problem 1) was run on one Android phone and stopped early by the owner. Its code is on the branch `spike/background-audio` and is not to be merged. What it found, and the decisions that followed, are recorded in ARCHITECTURE.md sections 7, 10 and 11: no microphone, a touch continues the night, the screen stays on and dims. `expo-audio` 57.0.5 is installed (owner, 2026-10-30) for the foreground voice sample in onboarding only; the audio library for the stories player is still the owner's choice. `expo-keep-awake` is allowed by the owner but not installed yet.

## The development cycle

Non-trivial work runs through subagents in `.claude/agents/`, driven by the `/feature` command. Tokens are scarce (100k tokens is about 10% of the owner's five-hour limit), so the cycle has three modes and hard limits:

- `lite`: `planner`, `executor`, one final check pass. No review. For UI, copy, small screens, config.
- `standard` (default): the same, plus ONE scoped `reviewer` pass at the end, on the risky files only. For most features.
- `full`: standard plus an `architect` sign-off. For a new module or table, a new dependency, a boundary change, or work centred on auth, keys or data access. Planner and reviewer run on Opus here, on Sonnet otherwise.

How it runs:

1. `planner` (read-only) returns a one-screen plan with a risk tier per step, the checks, the flags and a mode recommendation with a rough token cost. A person approves it before any file is touched.
2. `executor` (the only agent that writes) implements one step at a time with a fast check after each (typecheck and the unit test of what changed), and runs the full pass (lint, typecheck, test, plus build and integration tests when the API changed) once, at the end. Steps marked independent may run in parallel in the same working tree, in separate directories (no git worktrees: they lack `node_modules` and the git-ignored env files).
3. `reviewer` (read-only, fresh context) reads the listed files only, runs no `nx`, reports at most 8 findings and ends with `VERDICT: APPROVED` or `VERDICT: CHANGES_REQUESTED`. At most two rounds; the second looks only at the fixes.
4. `architect` (read-only, full mode only) checks structural fit once, with the same verdict format. No loop.
5. The final report carries a token table (one row per subagent run) so the cost of the cycle is visible.

Every agent starts from `.claude/agent-brief.md`: the rules in one line each, a map of ARCHITECTURE.md by section, and the output rules below. It replaces reading AGENTS.md, ARCHITECTURE.md and SECURITY.md whole (about 22k tokens). When a rule here changes, change the matching line in the brief. A person makes the commit. Small changes (a typo, a one-line config edit, a rename) skip the cycle.

### Output discipline (for every agent and for the main session)

- Never print a whole file, a long log or a whole diff. Use `grep`, `sed -n`, `head`, `tail`, `git diff --stat`.
- Filter Nx output to its result lines. Do not add `--skip-nx-cache` unless a cached result is suspect.
- Run the full check pass once at the end of a feature, not after every step.
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
