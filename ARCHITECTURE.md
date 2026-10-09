# Architecture

Decisions recorded on 2026-10-08, before any feature code exists. Library versions are pinned at install time; before writing setup code for any dependency, check its current documentation, because setup steps change between major versions.

Every decision below carries one sentence on what it buys and what it costs. A decision stated without its reason reads as arbitrary and gets undone, so keep the reasons when editing.

## 1. Purpose and scope

Sleep Stories plays a queue of short, AI-generated stories in Russian so a person can fall asleep to them. A story is usually one to three minutes long, never longer than about three. A typical night is two or three stories.

MVP scope:

- Accounts. Each person signs in and has their own profile (email and password, Google, Apple).
- Onboarding: choose a narrator voice, interests and story styles.
- A queue that is already filled when the app opens. The backend keeps adding stories while the person listens, so there are always unheard ones.
- Offline playback with background audio, from files downloaded in advance.
- At the end of the queue the app asks aloud "Вы спите?". A spoken answer continues the night with more stories; silence fades the audio out and stops.
- A history of what was listened to.
- Ratings: a person can rate a story (`story_ratings`, one rating of -1 or 1 per user and story). Moved out of "Deferred" by the owner. Buys the rating data from day one, so the later recommendation algorithm has history to use; costs a rating control in the UI, and where in the app a person rates is not decided (section 11).
- Russian only. Dark UI only.

Story styles: «Факты» (facts), «Сказка» (fairy tale), «История» (historical story).

## 2. System overview

```
┌──────────────────────┐   HTTPS + Supabase JWT    ┌───────────────────────────┐
│  Mobile (Expo)       │ ────────────────────────▶ │  API (NestJS, Cloud Run)  │
│  - player, queue     │ ◀──────────────────────── │  - user routes            │
│  - local STT / voice │                           │  - /internal/* routes     │
│    detection         │                           └──┬────────┬───────────┬───┘
└─────────┬────────────┘                              │        │           │
          │ sign-in only                              │ Prisma │           │ enqueue
          ▼                                           ▼        │           ▼
┌──────────────────────┐                  ┌────────────────────┐│   ┌───────────────┐
│  Supabase Auth       │                  │ Supabase Postgres  ││   │ Cloud Tasks   │
└──────────────────────┘                  └────────────────────┘│   └──────┬────────┘
                                                                │          │ HTTP + OIDC
          signed URL (short-lived)                              ▼          │ (retries, rate limit)
┌──────────────────────┐  upload  ┌────────────────────┐   ┌────────────┐  │
│  Supabase Storage    │ ◀─────── │ providers          │ ◀─┤ LLM / TTS  │ ◀┘
│  (private bucket)    │          │ (adapters in API)  │   └────────────┘
└──────────────────────┘          └────────────────────┘
        ▲
        └── mobile downloads audio with the signed URL, then plays the local file

Cloud Scheduler ──▶ API /internal/* (periodic queue top-up)
```

The mobile app talks to exactly two things: the API (with the user's JWT) and Supabase Auth (to sign in). It never reads tables, never holds a provider key, and downloads audio only through signed URLs that the API hands out.

## 3. Monorepo and module boundaries

Nx workspace, npm, TypeScript in strict mode.

| Path | Tag | May import |
|---|---|---|
| `apps/mobile` | `scope:mobile` | `scope:shared` |
| `apps/api` | `scope:api` | `scope:shared` |
| `packages/contracts` | `scope:shared` | nothing except `zod` |

- `packages/contracts` holds Zod schemas and the types inferred from them: request and response bodies, the structured output expected from the LLM, shared enums. It buys a single source of truth for both apps without code generation; it costs coupling of the two apps to the same schema version, which is fine inside one repository.
- `packages/contracts` stays framework-free (no React Native, no Nest, no Prisma). If it grows a framework import, the mobile app and the API can no longer share it.
- The module-boundary rule is not configured yet. When it is added (`@nx/enforce-module-boundaries` with the tags above), prove it by adding a forbidden import on purpose and confirming that lint fails, then remove it. A boundary rule that nothing tests is documentation, not enforcement.

Target layout (created when first needed, not before):

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

## 4. Backend

**NestJS on Cloud Run, built as a Docker image.** Buys scale-to-zero and a familiar modular framework with a validation pipeline; costs cold starts and the fact that CPU is throttled outside of a request (see Background jobs).

**Prisma with Supabase Postgres.** Prisma Migrate owns the schema, and Supabase is only the host. Buys one place where the schema is defined and a typed client; costs that Supabase's own `auth` schema is not managed by Prisma. Reference the auth user id as a plain uuid and do not create a foreign key into the `auth` schema. Connect through Supabase's connection pooler, because Cloud Run opens many short-lived connections. Set up on 2026-10-09 with Prisma 7.10.0, checked against its documentation:

- **Two connection strings.** `DATABASE_URL` is the transaction pooler (port 6543) and is used by the running API. `DIRECT_URL` is the session pooler (port 5432) and is used only by the Prisma CLI through `apps/api/prisma.config.ts` (Prisma 7 keeps the URL there, not in `schema.prisma`). Buys migrations and the shadow database on a connection type that supports them while the API uses the cheaper pooled one; costs two variables, and `prisma generate` also fails when `DIRECT_URL` is unset (see section 11). The session pooler is used instead of the direct `db.<ref>.supabase.co` host because that host is IPv6-only and not reachable from every network.
- **Driver adapter.** The API builds `PrismaClient` with `@prisma/adapter-pg` on `pg`, in one place (`PrismaService`). Buys the Prisma 7 query compiler without a native engine binary; costs two more dependencies. `connectionTimeoutMillis` is 10 seconds so a stuck connect fails instead of hanging a request. `?pgbouncer=true` is not used (the adapter ignores it) and `statementNameGenerator` is not set. Pool size is left at the `pg` default; see section 11.
- **TLS to the database (runtime).** The API verifies the pooler's certificate against Supabase's public root CA, pinned in the repository as a string in `apps/api/src/app/prisma/supabase-ca.ts` (CN=Supabase Root 2021 CA, expires 2031-04-26; source URL and SHA-256 fingerprint are in the file) and passed as `ssl: { ca }`. Buys encrypted and verified traffic without changing any trust store and without `rejectUnauthorized: false`; without the CA, `ssl: true` fails with `SELF_SIGNED_CERT_IN_CHAIN` and the default `pg` connection is plaintext. Costs a Supabase-specific constant that must be rotated by hand before 2031 or if Supabase changes its CA. `pg` merges parameters from the connection string over the options passed in code, so a `?sslmode=disable` in `DATABASE_URL` would silently turn TLS off; the Zod env schema therefore rejects any `ssl*` parameter (and `uselibpqcompat`) in `DATABASE_URL`, with a message that does not echo the value.
- **Generated client.** `prisma-client` generator, output `apps/api/src/generated/prisma`, `moduleFormat = "cjs"` because the API is CommonJS under webpack. The directory is git-ignored and rebuilt by the `prisma-generate` Nx target, which `build`, `lint`, `typecheck` and `test` of `api` depend on. Buys no generated code in review; costs that a fresh checkout must run generate (Nx does it).
- **`dotenv`** (dev dependency, owner-approved) is imported only by `prisma.config.ts`. Buys that the Prisma CLI reads `apps/api/.env` when `prisma` is run directly (under Nx the file is already injected into every `api` task); costs a second env loader next to `@nestjs/config`, in the dev dependencies only. The running API reads the same file through `@nestjs/config` (version 4, the last CommonJS line; version 12 is ESM-only while the API is CommonJS). One env file buys one place to look; costs that `.env` loading is done by two mechanisms.
- **Raw SQL in the first migration.** Row level security on every table (and on `_prisma_migrations`, guarded because the table does not exist in Prisma's shadow database), CHECK constraints, and the partial unique index on `generation_jobs.dedupe_key`. Prisma's schema language has no syntax for RLS or CHECK constraints. Prisma 7.10 has a `partialIndexes` preview feature that could describe the partial index, but it is not enabled: a preview feature can change between releases, and one raw statement next to the others is simple. Buys database-enforced invariants and no preview dependency; costs that they are not visible in `schema.prisma`, so the schema carries comments pointing at them.

**All data goes through the API, and tables have RLS enabled with no policies.** Buys exactly one authorization layer, written in TypeScript; costs that the mobile app cannot query Supabase directly or use realtime subscriptions.

**Validation and configuration.** Zod everywhere (`nestjs-zod` in the API). `@nestjs/config` with a Zod schema, so a missing secret crashes the process at boot instead of failing later at the first request.

**Hardening and operations.** `helmet`, `@nestjs/throttler`, `nestjs-pino` (structured logs go to Cloud Logging), `@nestjs/swagger`. Secrets live in Google Secret Manager. CI/CD is GitHub Actions building the image and deploying to Cloud Run with Workload Identity, so there are no long-lived keys in the repository.

**Background jobs: Cloud Tasks, with Cloud Scheduler for periodic triggers.**
Generating one story takes tens of seconds: an LLM call, a TTS call and an upload. Cloud Run limits CPU outside of an active request and can stop an idle container, so doing this "after the response" silently loses work. Cloud Tasks stores the job durably and calls an API endpoint, which keeps a request open for the duration of the work, retries failures with backoff, and caps concurrency so provider limits and costs are protected. It needs no Redis. It costs coupling to GCP, internal endpoints that must authenticate the caller, and an open question about local development (see Known open problems). The simpler alternative that was considered, a jobs table polled by Cloud Scheduler, was passed over because retries and concurrency control would have to be hand-written.

**Provider adapters.**
- `LlmProvider` wraps `@anthropic-ai/sdk` and uses a cheap model. Topic lists and story metadata come back as structured JSON validated with Zod.
- `TtsProvider` wraps the chosen speech provider, which is not chosen yet: it is selected after listening to Russian samples, because quality in Russian cannot be judged on paper.
- Storage is Supabase Storage in a private bucket.

Buys: replaceable vendors and one place where keys and spend are controlled. Costs: one small interface per provider.

**One story, one request.** A story is generated whole: one LLM call, one TTS request, one audio file in MP3 or AAC. Stories are short enough that nothing needs splitting, so there is no chunking and no ffmpeg. The audio duration is read from the file with `music-metadata`. The one thing to verify on the chosen TTS provider is its per-request text limit (a three-minute Russian story is roughly 2,500 to 3,500 characters). If a provider's limit is lower than that, revisit this decision with the owner instead of adding chunking quietly.

**Storage: Supabase Storage rather than Google Cloud Storage.** Buys one vendor next to the database and auth, a built-in CDN, and a one-call signed URL; costs that files live on a different cloud than the API. Compared on 2026-10-08, and worth rechecking before relying on it:

| | Supabase | Google Cloud Storage (EU regional) |
|---|---|---|
| Storage | Free 1 GB; Pro ($25/month) includes 100 GB, then about $0.0213/GB | about $0.020/GiB-month |
| Egress | Free 5 GB; Pro includes 250 GB, then $0.03/GB cached or $0.09/GB uncached | $0.12/GiB (first 10 TiB per month) |
| Max file | Free 50 MB; Pro 500 GB | no practical limit |
| Catch | Free projects are paused after a week of inactivity | pay from the first byte; free tier covers US regions only |

At a few users either option costs almost nothing. The database stores only the object path, never a URL, so moving to GCS later is a contained change.

Sources: [Supabase pricing](https://supabase.com/pricing.md), [Supabase Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [Cloud Storage pricing](https://cloud.google.com/storage/pricing).

## 5. Data model

Decided and implemented in the first migration (`apps/api/prisma/migrations`, 2026-10-09). Do not add entities beyond this list without asking.

Naming: Prisma models are PascalCase singular with camelCase fields; tables are snake_case plural (`@@map`), columns are snake_case (`@map`), enum types and their values are snake_case. Surrogate primary keys are `uuid` with a database default of `gen_random_uuid()`; `users.id` comes from Supabase Auth and has no default, and composite primary keys need none. Timestamps are `timestamptz(3)`. `created_at` and `updated_at` default to `now()` (and Prisma maintains `updated_at`); `listens.listened_at`, `user_topics.dismissed_at` and the `started_at` and `finished_at` columns of `generation_jobs` have no default, because their values come from an event (the client's listen report, a dismissal, a job starting or finishing). Buys one predictable mapping and no surprises in SQL; costs the `@map` noise in the schema file.

| Group | Table | Purpose |
|---|---|---|
| Reference | `voices` | Narrator voices: slug, name, description, TTS provider and its voice id, object paths of the sample audio and of the pre-rendered «Вы спите?» prompt, sort order, active flag |
| Reference | `interests` | Interests offered in onboarding: slug, title, sort order, active flag |
| Users | `users` | One row per person. `id` is the Supabase auth user id (plain uuid, no default, no foreign key into `auth`). The cascade anchor for everything per-user |
| Per-user | `user_preferences` | Chosen voice and story styles (`story_style[]`, at least one). One row per user, created when onboarding finishes |
| Per-user | `user_interests` | Chosen interests, primary key (user, interest) |
| Per-user | `user_custom_interests` | Free-text interests a person typed, not blank |
| Content | `topics` | An idea for a story: title, style, optional interest. Not tied to one user |
| Content | `stories` | The finished text for a topic (one story per topic): text, character count, LLM model, prompt version. Created only when complete. No owner column |
| Content | `story_audio` | One audio file per (story, voice): object path, duration, byte size, MIME type, TTS provider |
| Per-user | `user_topics` | Topics offered to or requested by a person (`proposed` or `requested`), with `dismissed_at` when they said no |
| Per-user | `queue_items` | The person's queue: a topic and a position |
| Per-user | `listens` | One row per listening: story, voice, seconds listened, when |
| Per-user | `story_ratings` | One rating per user and story: `-1` or `1` |
| System | `generation_jobs` | One row per generation attempt chain: kind (`suggest_topics`, `write_story`, `render_audio`), payload, dedupe key, requesting user, status, attempt count, last error |

Rules that follow from the reasoning:

- **Content is separate from per-user state.** `topics`, `stories` and `story_audio` have no owner, so a shared cache with tags can be added later without a migration. Everything per-user lives in the per-user tables above. Buys that cache for free; costs a join to get "this person's story".
- **`users` is the cascade anchor.** Every per-user table references it with `ON DELETE CASCADE`, so removing a person is one delete. `generation_jobs.requested_by_user_id` is `ON DELETE SET NULL` instead, so the cost history of generation survives the person (it costs a nullable column). Every reference to content and to reference data is `RESTRICT`, so shared content cannot disappear because of one deletion. The foreign key columns on the RESTRICT side (`listens.story_id`, `listens.voice_id`, `story_ratings.story_id`, `queue_items.topic_id`, `user_topics.topic_id`, `user_interests.interest_id`, `user_preferences.voice_id`, `story_audio.voice_id`) have no indexes of their own. That is a known cost: deleting a referenced row would scan those tables. Revisit it if deleting content is ever designed. Wiring the deletion of the Supabase auth user to the `users` row is not done yet.
- **The queue references topics, not stories.** A topic can be queued before its story exists, and the generation pipeline never touches the queue (section 6). Costs a join through `topics` to reach the audio. `queue_items` has a unique (user, topic) and an index on (user, position), and deliberately no unique on position: reordering rewrites positions inside one transaction without tripping over a transient duplicate.
- **Voice is per audio file.** `story_audio` is unique on (story, voice), so a story's text is written once and rendered per voice. Buys changing a voice without rewriting text; costs more audio rows and storage.
- **The listen outcome is derived, never stored.** `listens` records `listened_sec`; finished or skipped is computed from it and the audio duration. Buys that the threshold for "finished" can change without a data fix; costs a computation wherever the outcome is read. `listens.listened_at` has no database default because the value comes from the client event, and the index is (user, `listened_at` descending) for the history screen.
- **User intent and system health are separate axes.** What the person chose lives in the per-user tables. Whether the system managed to produce a story (`pending`, `running`, `succeeded`, `failed`) lives in `generation_jobs`. They are never merged into one enum, because recovering from a failure must not lose what the person chose.
- **At most one active job per dedupe key.** A partial unique index on `generation_jobs.dedupe_key` where the status is `pending` or `running` makes a duplicate request fail in the database, while a finished job and a new one may share a key. Buys idempotent enqueueing without locks; costs raw SQL outside Prisma's schema.
- **A story row exists only when complete.** A `stories` row holds finished text; its audio is a separate `story_audio` row per voice, created later. There are no half-filled stories, so no nullable text or audio columns that apply to only one lifecycle stage.
- **Ratings are in the MVP.** The data is recorded from day one (a rating per user and story, `-1` or `1`) together with listens. The algorithm that uses them is deferred; the data is not.
- **Paths, not URLs.** `story_audio.storage_path` (unique) and the voice audio columns hold storage object paths. Signed URLs are created per request and never stored.
- **`generation_jobs.payload` is parsed, not trusted.** It crosses a boundary (SECURITY.md rule 5), so it is parsed by a Zod schema keyed on `kind`, with the schemas in `packages/contracts`. That package does not exist yet; this is a task for later.
- **Row level security is on for every table, with no policies,** including Prisma's `_prisma_migrations`. CHECK constraints enforce what the application also validates: at least one style, a non-blank custom interest, positive character count, duration and byte size, non-negative listened seconds, rating in (-1, 1).

## 6. Generation pipeline

The work is split into jobs of three kinds (`job_kind`). Each job is one `generation_jobs` row and one Cloud Task.

1. **Trigger.** After onboarding, when a user's unheard queue drops below a threshold, on a Cloud Scheduler top-up, or on an explicit user request, the API creates `generation_jobs` rows and enqueues one Cloud Task per job.
2. **Dispatch.** Cloud Tasks calls an `/internal/*` endpoint with a Google OIDC token. The endpoint verifies the token before doing anything. Queue settings cap concurrent dispatches and rate.
3. **Idempotency.** The handler first checks the job. A job that already succeeded returns 200 without doing work. This protects against retries that arrive one after another: they never create duplicate topics, stories or audio rows. It holds because each job kind marks the job `succeeded` in the same database transaction that creates its rows (step 4), so the success mark and the rows commit together or not at all. It does not protect against two overlapping runs of the same task (section 11, item 20), and storage objects can still be orphaned (item 18).
4. **The job kinds.**
   - `suggest_topics` creates topics, and the `user_topics` rows that record them as offered. The topics and `user_topics` rows are created in one transaction with marking the job `succeeded`.
   - `write_story` writes the story only, with no audio file yet. `LlmProvider` returns the text and metadata as structured output, validated with Zod, and the length is checked against the TTS limit. The `stories` row (text complete) is created in one transaction with marking the job `succeeded`.
   - `render_audio` creates the audio itself. It makes the TTS request through `TtsProvider`, reads the duration from the returned file, saves the file to private storage, and saves the `story_audio` row to the database in one transaction with marking the job `succeeded`.
5. **How this keeps "a story is generated whole".** One LLM call, in `write_story`. One TTS request per story and voice, in `render_audio`, returning one audio file. No chunking, no ffmpeg. Splitting the work into jobs changes who runs each step, not how many calls a story takes.
6. **Readiness.** A queue item is ready when a `story_audio` row exists for its topic's story in the person's voice. The pipeline writes no queue row; the queue references topics (section 5) and is managed by the user-facing API.
7. **Chaining.** `render_audio` follows a successful `write_story`, for the person's voice. Who enqueues it, and the `dedupe_key` format per kind, are open (section 11).
8. **Failure.** The handler returns a 5xx and Cloud Tasks retries with backoff. After the maximum number of attempts the job is marked `failed`. A failed `write_story` leaves no `stories` row. A failed `render_audio` leaves a story without audio in that voice, which is not ready.

Delivery to the phone: the app asks the API for its queue, receives short-lived signed URLs for the audio of ready queue items (a `story_audio` row exists in the person's voice), downloads the files, and plays local files. It reports listens (how many seconds were played) back to the API; whether a listen counts as finished or skipped is derived from that and the audio duration.

## 7. Mobile app

**Expo (React Native).** Buys config plugins for native settings, EAS builds and over-the-air updates; costs that Expo Go cannot run the pieces that need native code (MMKV, local speech recognition, the Do Not Disturb module) or be relied on for background audio, so development builds are required from the player work onwards.

| Concern | Choice |
|---|---|
| Navigation | Expo Router, if it works inside the Nx-generated app (see Known open problems); otherwise React Navigation |
| Server data | TanStack Query |
| Local state | Zustand, persisted with MMKV |
| Small local storage | MMKV (`react-native-mmkv`): synchronous key-value storage for voice, speed, queue metadata and the list of downloaded stories, so the queue shows instantly at launch |
| Audio files | `expo-file-system` |
| Speech to text (local) | `expo-speech-recognition` |
| Answer to "Вы спите?" | Start with microphone level detection, no ML model; a local model (Vosk or Whisper) only if level detection proves unreliable |
| Animation | `react-native-reanimated` and `@shopify/react-native-skia` for the voice orb |
| Fonts and icons | Onest via `@expo-google-fonts/onest`; `lucide-react-native` (thin strokes) |
| Forms | `react-hook-form` with Zod resolvers |
| Lists | `react-native-gesture-handler` plus a drag-to-reorder list library chosen when the queue screen is built |
| Builds and updates | EAS Build, EAS Submit, `expo-updates`; `expo-notifications` later |
| Tests | `jest-expo` and React Native Testing Library; Maestro for end-to-end later |

Not chosen yet, and not to be chosen by an agent: the audio library (react-native-track-player or expo-audio) and the styling approach (NativeWind or plain StyleSheet with a tokens file). Both are in Known open problems.

**Microphone privacy.** Microphone audio never leaves the device. Detection and any speech recognition are local. Nothing on that audio path may make a network call.

**The end of the night.**
1. The last story ends.
2. A pre-rendered audio prompt «Вы спите?» is played (generated once per voice and cached, not generated at runtime).
3. The app listens for a fixed window (the length is a setting).
4. A detected answer continues with further queued stories, which are already downloaded. No answer fades the audio out, stops, and restores whatever the app changed (Do Not Disturb).

**Quiet phone.** Android: a custom Expo module toggles Do Not Disturb with media allowed, which needs the user to grant notification-policy access once. iOS: there is no public API, so the person sets up a Focus (such as Sleep) once; media playback is not silenced by Focus.

## 8. Authentication

Supabase Auth with email and password, Google and Apple. The mobile app holds only the Supabase URL and publishable key, signs in, and sends the access token to the API. The API verifies the JWT (with `jose`, against Supabase's published keys; confirm the current signing setup in the docs when implementing) and takes the user id from it. Anything about ownership is looked up by that id and never accepted as supplied by the client. App Store review expects an equivalent privacy-preserving sign-in option whenever third-party sign-in such as Google is offered, and Sign in with Apple is the usual way to satisfy it. Check the current App Store guideline before launch rather than assuming either way.

## 9. Design language

Chosen from three explored directions: "dark minimal night". The designs produced from the Claude Design prompt are the source of truth once they exist. These are the starting values.

- Dark only. No pure white anywhere. Text contrast at least 4.5:1. Touch targets at least 44 px.
- Colors: base `#09070F`; top violet glow `#2B1B6B` fading out; bottom coral glow `rgba(255,112,120,0.28)` fading out; text `#F1ECFF` and `#E9E3FA`; muted `#A9A1D2`; accent gradient `#FF9A7B` to `#FF6F9C` for the single primary action, with text `#1B0D1E` on it; hairlines `rgba(233,227,250,0.12)`.
- Typography: Onest only. Very light weight (200) for large numerals, regular and medium for titles, small uppercase labels with wide letter-spacing.
- Structure: no cards or heavy boxes; hairlines separate content. Thin 1.6 px line icons, no emoji.
- The voice orb: a blurred conic gradient (`#8F7CFF`, `#FF8A6B`, `#FF5E9A`, `#5B6CFF`) shaped into a slowly rotating glowing ring with a dark inner disc and a counter-rotating soft glow behind it, breathing gently. All motion is slow.
- Screens: onboarding (sign in, voice, interests and styles, permissions), Today, Topics, Player (playing, dimmed, "Вы спите?" listening, falling asleep), Library, Settings. The player is the quietest screen and has no bottom navigation.
- The home hero reads «Добрый вечер», «Что послушаем сегодня перед сном?», then «3 истории · около 9 минут».

## 10. Deferred and rejected

**Deferred. Not in the MVP and not to be built or designed for yet:**

- Sharing generated stories between users, with tags. (The data model leaves the door open: see section 5.)
- A decision model that interprets free-form spoken commands. The MVP uses buttons plus the answer detection described above.
- The recommendation algorithm that uses ratings and listens. Only the recording of ratings and listens is in scope.
- Other languages and any i18n library. All copy is Russian and lives in one strings module.
- More than one profile per account.
- **Cleaning up old stories and audio files.** This was discussed because the Supabase Free tier has 1 GB of storage. One possible policy was noted (for example deleting listened, unrated stories after some days). It is not planned and is not being thought about now. Do not design or build it.

**Rejected, with reasons, so nobody re-adds them:**

- **Sentry.** The owner does not want it. Logs go to Cloud Logging through `nestjs-pino`.
- **ffmpeg and chunked audio.** Stories are generated whole and are short; nothing needs joining, normalising or splitting.
- **BullMQ, Redis, pg-boss.** Cloud Run throttles background CPU, and Cloud Tasks covers the need without extra infrastructure.
- **SQLite on the phone.** MMKV plus files cover the offline needs.
- **Google Cloud Storage for audio.** Not rejected for being worse, only for being less simple here; see section 4.

## 11. Known open problems

These are real gaps. Agents must not settle them silently; stop and ask the owner.

1. **Background audio and the microphone (the main risk).** Does audio keep playing with the screen off, and can the app open the microphone in the background after the last story and hear an answer, on both iOS and Android? A spike must answer this before the rest of the player is built. The audio library choice (react-native-track-player or expo-audio) depends on the result, including a gapless queue and lock-screen controls.
2. **Telling speech from other sounds.** Level-only detection could treat snoring, a TV or a partner's voice as "still awake". It may need a short local recognition step to confirm a spoken word.
3. **Expo Router inside the Nx-generated Expo app.** The generated app uses `index.js` and `src/app/App.tsx` rather than the Expo Router structure. Verify it works before committing to it; React Navigation is the fallback.
4. **Styling approach.** NativeWind or plain StyleSheet with a tokens file. Decide at the first UI task.
5. **TTS provider.** Pick after listening to Russian samples, and verify its text-length limit against section 4.
6. **Database connections from Cloud Run.** The pooler setup for Prisma 7 is done (section 4). Still undecided or unverified:
   - The `pg` pool size against Cloud Run concurrency, because each instance has its own pool (default size 10) and the transaction pooler has its own client limit.
   - `prisma generate` requires `DIRECT_URL` to be set, so CI and the Docker build need either a placeholder value or a Prisma config that does not demand it.
   - The Prisma CLI connection (`DIRECT_URL`, used by migrate) uses opportunistic TLS (the equivalent of `sslmode=prefer`) and the certificate is not verified. Checked on 2026-10-09: with the default URL the schema engine starts TLS and succeeds, while adding `sslaccept=strict` fails with "The certificate was not trusted" and `sslmode=disable` also succeeds. An active attacker on the network can therefore strip TLS or intercept it, as well as read plaintext. Making it verified would need the CA supplied to the schema engine, which has not been tried. If it is fixed with a certificate file, keep a single source for the Supabase CA (not a `.crt` file plus the TypeScript string).
   - The pinned Supabase root CA must be rotated by hand (see item 21).
7. **Local development of Cloud Tasks.** Choose between an emulator and a development-only direct call path for the internal endpoints.
8. **Cost control.** There is no per-user quota design yet. Every path that reaches a paid provider needs one before launch. Vendor-side spending caps should also be set.
9. **Sign-in provider setup.** Google and Apple configuration, redirect URIs, and the App Store sign-in expectation noted in section 8.
10. **Supabase Free tier.** Projects pause after a week of inactivity. Fine for development; not for a launch.
11. **Workspace naming.** The default `@org` package scope has not been renamed.
12. **Chaining and dedupe keys for generation jobs.** How `render_audio` is enqueued after `write_story` (who enqueues it, with which retries), and the `dedupe_key` format per job kind. `generation_jobs` has no foreign key to topics, so `dedupe_key` is the only link between a queue item and its jobs. Also undefined: who appends to `queue_items` on an automatic or Scheduler top-up. Section 1 promises the backend keeps adding stories while the person listens, but the pipeline itself writes no queue row.
13. **Stuck jobs.** A `pending` job whose enqueue failed, or a `running` job that dies before marking itself `failed`, holds its dedupe key forever, because the partial unique index only frees the key when the status leaves `pending` or `running`. A staleness rule or a Cloud Scheduler sweep, and the order of "insert the row, then enqueue the task", are undecided.
14. **Duplicate listens.** `listens` has no client-generated event id or unique key, so a retried offline report of the same listen would create a second row. An idempotency key is undecided.
15. **Deleting an account.** Deleting the Supabase auth user and then the `users` row (the cascade removes the rest) is not wired. App Store review expects in-app account deletion; it is on the pre-launch checklist in SECURITY.md. The cascade does not remove everything a person wrote: text the person typed (custom topic requests) remains in the shared `topics` table, because content has no owner column and its references are `RESTRICT`, and in `generation_jobs.payload`, because `requested_by_user_id` is only set to null. What to do with that text (anonymise, delete or keep) is to be decided.
16. **Graceful shutdown.** `PrismaService.onModuleDestroy` never runs on SIGTERM because `main.ts` does not call `enableShutdownHooks`. Belongs to the Cloud Run deployment task.
17. **Where a person rates a story.** Ratings are in the MVP scope (section 1) but the screen and moment for rating are not decided.
18. **Orphaned audio objects.** `render_audio` uploads the file before the database transaction, so a failure between the upload and the commit leaves an object in storage with no `story_audio` row. Whether `storage_path` is deterministic per (story, voice) is undecided.
19. **Packaging and caching of the built API.** `generatePackageJson` in `apps/api/webpack.config.js` writes `dist/apps/api/package.json` without `@prisma/client`, although the bundle requires `@prisma/client/runtime/client` and the query-compiler wasm (checked on 2026-10-09 against a fresh build), and `@prisma/adapter-pg` does not depend on `@prisma/client`. A pruned install or the future Docker image would fail at startup. The generated `package.json` also lacks `pg` and `tslib` (the bundle requires `tslib`; checked against `dist/apps/api/package.json` after a build), so a pruned install would resolve `pg` through `@prisma/adapter-pg`'s `^8.16.3` range and the `8.23.1` pin would not reach production. Separately, the cache inputs of the `build` target do not hash `@prisma/client` (the bundle inlines the generated client); it is covered today only because `prisma` is hashed and both are pinned to the same version. Belongs to the Cloud Run deployment task.
20. **Concurrent double delivery of the same Cloud Task.** Cloud Tasks delivers at least once. Nothing prevents two overlapping runs of the same task: `suggest_topics` has no natural unique key, so overlapping runs can create duplicate topics and `user_topics` rows. To be solved when the generation pipeline is built.
21. **Rotation of the pinned Supabase root CA.** `apps/api/src/app/prisma/supabase-ca.ts` must be rotated by hand before 2031-04-26, or sooner if Supabase changes its CA. When that happens the service fails closed at boot with a certificate error.
