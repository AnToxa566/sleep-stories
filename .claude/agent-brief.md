# Agent brief

Read this file first. It replaces reading AGENTS.md, ARCHITECTURE.md and SECURITY.md from top to bottom, which costs about 22k tokens per agent. The sources stay authoritative: if this brief and a source disagree, the source wins, and you say so in your report. When you change a rule in AGENTS.md, change the matching line here.

## How to read the long documents

1. List the headings: `grep -n '^## \|^### ' ARCHITECTURE.md` (11 lines).
2. Read only the sections you need: `sed -n '<first>,<last>p' ARCHITECTURE.md`.
3. List the open problems with `sed -n '/^## 11\./,$p' ARCHITECTURE.md | grep '^[0-9]*\. \*\*' | cut -c1-90`. Never read all of section 11 unless the task touches it.
4. `SECURITY.md`: read the threat table and the checklist only when the task touches keys, auth, data access, storage, internal endpoints, prompts or the microphone.
5. Never print a whole file, a long log or a full diff. Use `grep`, `sed -n`, `head`, `tail`, `git diff --stat` and `git diff -- <path>`.

| Topic | Where |
|---|---|
| Layers, tags, imports | ARCHITECTURE.md section 3 |
| API, database, local stack, TLS | section 4 |
| Tables and ownership | section 5 |
| Jobs and generation | section 6 |
| Mobile app, styling, session on the device | section 7 |
| Auth | section 8 |
| Look and copy | section 9 |
| Rejected and deferred ideas | section 10 |
| Open problems (not yours to decide) | section 11 |

## Rules in one line each (source: AGENTS.md)

Architecture:
1. `apps/mobile` and `apps/api` import only `packages/contracts`, never each other. `packages/contracts` imports only `zod`.
2. Paid or secret-bearing SDKs (`@anthropic-ai/sdk`, the TTS SDK, the Supabase service-role client) only inside their adapter in `apps/api`.
3. Prisma Migrate owns the schema. No manual changes. No foreign keys into `auth`.
4. Story content has no owner column. Per-user state lives in the per-user tables. A listen outcome is derived, never stored. User intent and generation health are separate enums.
5. A story is generated whole: one LLM call, one TTS request, one audio file. No chunking, no ffmpeg.
6. Background work only through Cloud Tasks and Cloud Scheduler. No fire-and-forget after the response, no Redis, no BullMQ.
7. Only libraries named in ARCHITECTURE.md. A new dependency needs the owner's approval first.
8. UI is dark-only, no pure white, Russian copy in one strings module, one primary action per screen.
9. Anything under "Known open problems" is the owner's decision: stop and ask.

Security:
1. Provider keys only on the server (Secret Manager, or a git-ignored env file locally). Never in the mobile app, contracts, logs, prompts or error responses.
2. The user id comes only from a verified Supabase JWT, never from body, query or headers. Every user-data query is scoped by it.
3. Every table has RLS on and no policies. The app never queries tables directly. Buckets are private; the app gets short-lived signed URLs from the API.
4. Every `/internal/*` endpoint verifies a Google OIDC token (audience and service account). A user JWT is refused. (Only exception: `JOB_QUEUE=local` for development, refused in production and on Cloud Run; SECURITY.md rule 4.)
5. Every boundary crossing (request, response, structured LLM output) goes through a Zod schema from `packages/contracts`. No `any` at a boundary.
6. Microphone audio never leaves the device.
7. User topic text is untrusted data, never put into system instructions. LLM output is plain text, never executed or used to pick tools or URLs.
8. The database stores storage paths, never signed URLs.
9. No secrets, tokens, emails or story text in logs.
10. Text a person typed, and stories made from it, are never shown to anyone else; reuse only topics with no `requested` `user_topics` row.

## Working rules

- Language: code, comments, commit messages and docs in English; user-facing copy in Russian. TypeScript strict.
- Run tasks as `npx nx <target> <project> --outputStyle=static` and filter the output to the result lines (`| grep -E "Tests:|error|✖|Successfully|Failed"`). Never guess a flag: check `--help` once. Do not add `--skip-nx-cache` unless a cached result is suspect.
- Check the current documentation before writing setup code for a dependency, and for a native Expo module read the native signature in `node_modules/<pkg>` as well as its types. Pin exact versions.
- Nothing is done because it looks right. Pass or fail output is the only evidence.
- Do not commit unless the owner asks. Commit types: chore, feat, docs, build, refactor.
- The `design/` folder (git-ignored, local) is the source of truth for screens. If it is missing, ask; never invent a design. It contains mistakes: there are NO series of stories ("Продолжить серию" is a designer's error; ARCHITECTURE.md section 10). Anything in a design that the architecture lacks is a question for the owner, not a requirement.

## Open problems today (run the command in step 3 for the current list)

Audio library for the stories player (expo-audio is decided only for the onboarding voice sample), TTS provider, background audio on iOS, the Prisma CLI's unverified TLS, rotation of the pinned Supabase CA, the Cloud Tasks queue, the Scheduler and the production deployment (job chaining, stuck jobs and double delivery are decided in cycle 3b-1; the handlers and the trigger after onboarding are cycle 3b-2), duplicate listens, account deletion, shutdown hooks, rating placement, orphaned audio, packaging of the built API, quotas and cost control, sign-in providers, email confirmation and account enumeration, session edge cases (item 27), who refills the queue.
