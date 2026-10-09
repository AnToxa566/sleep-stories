# Sleep Stories: guide for coding agents

Sleep Stories is a mobile app that plays a queue of short, AI-generated Russian-language stories so a person can fall asleep to them. Stack: Nx monorepo (npm), Expo (React Native) app, NestJS API on Google Cloud Run, Supabase (Postgres, Auth, Storage) with Prisma, Cloud Tasks for background jobs.

## Read first

- `ARCHITECTURE.md`: boundaries, data model, every decision with its reasoning, what is deferred or rejected, and the open problems. It records why, not only what. Use its reasoning instead of deriving your own.
- `SECURITY.md`: threat model and the pre-launch checklist. Read it whenever a change touches keys, auth, data access, storage, internal endpoints, prompts or the microphone.

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
| Generated Prisma client (git-ignored, never edited by hand) | `apps/api/src/generated/prisma` |
| LLM, TTS and storage adapters | `apps/api/src/app/providers` |
| Cloud Tasks and Scheduler handlers | `apps/api/src/app/internal` |
| Prompts | `apps/api/src/app/generation/prompts` |
| Zod schemas and shared types | `packages/contracts/src` |
| Subagents and the `/feature` command | `.claude/agents`, `.claude/commands` |

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
npx nx start mobile         # Metro bundler (Expo)
npx nx lint mobile
npx nx typecheck mobile
npx nx run-ios mobile       # needs Xcode
npx nx run-android mobile   # needs Android Studio
```

Database setup: copy `apps/api/.env.example` to `apps/api/.env` (git-ignored) and fill in `DATABASE_URL` (Supabase transaction pooler, port 6543, used by the running API) and `DIRECT_URL` (Supabase session pooler, port 5432, used only by the Prisma CLI). Never print or commit `.env`. The `prisma-*` targets pass extra arguments after `--`. `build`, `lint`, `typecheck` and `test` of `api` depend on `prisma-generate`, so they need `DIRECT_URL` set even though they do not touch the database. `serve` depends on `build`, so `npx nx serve api` also regenerates the client after a schema change (checked); running `prisma` directly in `apps/api` does not. Never use `prisma db push`; migrations are the only way the schema changes.

`npx nx test api` runs the two scaffold specs; no tests of our own exist yet, and `mobile` has no test target.

## Current state

- `apps/api` is the NestJS "Hello API" scaffold plus a global `PrismaModule`/`PrismaService` (Prisma 7 with `@prisma/adapter-pg`) and Zod-validated environment configuration that fails at boot. `apps/mobile` is the default Expo screen. They are not connected.
- The 14-table schema and its first migration (`init`, with RLS on every table and `_prisma_migrations`, CHECK constraints and a partial unique index) are in `apps/api/prisma`. It is applied to the development Supabase database. No seed data.
- Not created yet: `packages/contracts`, authentication, any deployment, the module-boundary lint rule, CI.
- The workspace still uses the default `@org` package scope.

## The development cycle

Non-trivial work runs through four subagents in `.claude/agents/`, driven by the `/feature` command:

1. `planner` (read-only) returns a plan. A person approves it before any file is touched.
2. `executor` (the only agent that writes) implements one step at a time and runs the verification command after each.
3. `reviewer` (read-only, fresh context) reviews the diff and ends with `VERDICT: APPROVED` or `VERDICT: CHANGES_REQUESTED`.
4. `architect` (read-only, fresh context) checks structural fit after the reviewer approves, with the same verdict format.

A person makes the commit. Small changes (a typo, a one-line config edit, a rename) skip the cycle.

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
