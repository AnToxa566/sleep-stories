# Project map

A short text map for the owner: which modules exist, what each is for, which invariants must not break, and why the key decisions were made. It is an index, not a copy: the reasoning lives in [ARCHITECTURE.md](ARCHITECTURE.md) and the threat model in [SECURITY.md](SECURITY.md). Rules are named by number: "A-n" is Architecture rule n and "S-n" is Security rule n in [AGENTS.md](AGENTS.md); "§n" is a section of ARCHITECTURE.md.

Update this file only when a module or boundary appears, an invariant is added, or an architectural decision is made or changed (AGENTS.md, "The project map"). Keep it at 180 lines or fewer and delete what is out of date. Last reviewed: 2026-11-05.

## 1. The system in five lines

- A phone app plays a queue of short Russian stories so a person can fall asleep (§1).
- The app talks to exactly two things: the API (with the user's JWT) and Supabase Auth (to sign in). It never reads tables and never holds a provider key (§2, S-1, S-3).
- The API (NestJS on Cloud Run) owns authorization, the database (Prisma on Supabase Postgres), the queue and the generation pipeline (§4).
- Stories are made by background jobs (Cloud Tasks) calling an LLM, then a TTS provider, then storing one audio file (§6).
- Nothing that costs money starts on its own: a person starts it, within 5 generations per rolling 24 hours (A-10, §6 "Generation is explicit").

## 2. Modules and who may import whom (§3)

| Module | Responsible for | May import |
|---|---|---|
| `packages/contracts` | Zod schemas and types for every boundary: request and response bodies, job payloads, structured LLM output | only `zod` |
| `apps/api` | Everything with a key, a user id or a table | `contracts` |
| `apps/mobile` | Screens, navigation, local state, audio playback | `contracts` |

The apps never import each other (A-1). Contracts stay framework-free: no React Native, Nest or Prisma.

## 3. API modules (`apps/api/src/app`, §4 to §6)

| Folder | Responsible for |
|---|---|
| `auth` | Global deny-by-default JWT guard; the user id comes only from the verified token (S-2, §8) |
| `me`, `users`, `interests`, `voices` | Profile and onboarding, reference data, signed sample URLs |
| `queue` | The user-facing queue: read, edit, reorder, add, replace, top-up, rebuild, continue, the explicit start of generation, topics (§6 "The user-facing queue API") |
| `listens` | One listen report per story; never changes the queue (§6) |
| `generation` | Three database-free services (topic suggester, story writer, audio renderer) and the prompts |
| `internal` | `/internal/*`: the job executor, the sweeper and the three handlers; Google OIDC only (S-4, §6 "How jobs run") |
| `providers` | The only place that touches paid or secret SDKs: LLM, TTS, storage, job queue (A-2, §4) |
| `prisma` | The Prisma service, TLS pinning, `lockUserRow` (the one place that locks the `users` row) |
| `config`, `validation`, `errors` | Zod-checked env that fails at boot; response validation that fails closed; one error body shape (S-5) |

## 4. Mobile modules (`apps/mobile/src`, §7 to §9)

| Folder | Responsible for |
|---|---|
| `app` | Expo Router routes (tabs «Сегодня», «Темы», «Настройки»; stack «Замена», player) |
| `features/auth`, `features/gate` | Encrypted persistent session; where a person is sent after launch (§8) |
| `features/onboarding` | Three steps: voice, interests, styles |
| `features/today`, `features/topics` | The queue screen and the topic lists, filters, menus |
| `features/player` | The night player: modes, listen reports, the lock-screen control (§7 "The stories player") |
| `api`, `config` | The API client and public config (Supabase URL and publishable key only) |
| `ui`, `theme`, `strings.ts` | Dark-only look, no pure white; all Russian copy in one module (A-8, §9) |

## 5. Invariants (do not break; the text is in AGENTS.md)

- **Money:** story jobs only from an explicit action, under the `users` row lock, 5 per 24 hours (A-10). Guarded by `architecture.spec.ts` and `queue-rule-10.spec.ts`.
- **Keys and identity:** keys only on the server; the user id only from the JWT (S-1, S-2).
- **Data access:** RLS on every table with no policies; private buckets; signed URLs per request, paths in the database (S-3, S-8).
- **Content vs per-user state:** `topics`, `stories`, `story_audio` have no owner; the listen outcome is derived, never stored (A-4).
- **Privacy of typed text:** what a person typed is never shown to anyone else; only system-proposed topics are reused (S-10).
- **Boundaries:** every crossing goes through a Zod schema (S-5); user text never enters system prompts; model output is never executed (S-7).
- **Queue:** it changes only by the person's own actions; a failed job leaves the item and shows the failed state (§6).

## 6. Key decisions and why

| Decision | Why (one line) | Where |
|---|---|---|
| All data through the API; RLS on, no policies | One authorization layer, written in TypeScript; costs no direct Supabase queries from the app | §4 |
| Prisma Migrate owns the schema; Supabase is only the host | One place defines the schema and gives a typed client; `auth` schema stays Supabase's | §4 |
| Content separate from per-user state | A story made for one person can be offered to another with no migration | §5 |
| The queue references topics, not stories | A topic can be queued before its story exists | §5 |
| User intent and job health are separate axes | Merging them into one enum makes states ambiguous | §5 |
| A story is generated whole (one LLM call, one TTS request, one file) | Stories are short; no chunking or ffmpeg is needed | §4 |
| Background work only through Cloud Tasks | Cloud Run throttles background CPU; Cloud Tasks gives retries without Redis | §4, §10 |
| Generation is explicit and capped | The audio is the expensive stage; the owner decided on 2026-10-31 that nothing is generated on its own | §6 |
| Provider adapters set `maxRetries: 0`, forward no error text | Cloud Tasks owns retries; an SDK error can echo the request | §4 |
| Stories are reused across people only if system-proposed | Typed text is private by construction | §6, S-10 |
| Dark-only UI, plain `StyleSheet` with a tokens file | No extra dependency; one place for the palette | §7, §9 |
| No microphone; a touch continues the night, the screen stays on and dims | The background-audio spike showed the microphone path is not workable | §7, §10 |
| Encrypted persistent session on the device | The session survives restarts without keeping a token in plain storage | §8 |
| `expo-audio` for the player, with a lock-screen control per story | Chosen 2026-11-03; the long-run library is still the owner's choice | §7, §11 item 1 |
| Private, Android-only, one user in practice; cheapest option everywhere (Cloud Run scale-to-zero, one instance, europe-west1; Supabase Free; local APK builds; deploy and migrate by a button) | The app is made for the owner's wife; scale problems are solved when they appear | §12 |

## 7. Not decided and not built

Open problems are the owner's decisions; stop and ask (A-9, §11). Deferred and rejected ideas are in §10 (series of stories, mood filters, Sentry, Redis, SQLite, microphone). Not built yet: deployment, CI, password reset, email confirmation, Google sign-in, the Cloud Tasks queue and Scheduler, settings, ratings, a history of listens, the typed-topics field.
