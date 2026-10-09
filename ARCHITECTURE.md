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
| LLM, TTS and storage adapters | `apps/api/src/app/providers` |
| Cloud Tasks and Scheduler handlers | `apps/api/src/app/internal` |
| Prompts | `apps/api/src/app/generation/prompts` |
| Zod schemas and shared types | `packages/contracts/src` |

## 4. Backend

**NestJS on Cloud Run, built as a Docker image.** Buys scale-to-zero and a familiar modular framework with a validation pipeline; costs cold starts and the fact that CPU is throttled outside of a request (see Background jobs).

**Prisma with Supabase Postgres.** Prisma Migrate owns the schema, and Supabase is only the host. Buys one place where the schema is defined and a typed client; costs that Supabase's own `auth` schema is not managed by Prisma. Reference the auth user id as a plain uuid and do not create a foreign key into the `auth` schema. Connect through Supabase's connection pooler, because Cloud Run opens many short-lived connections. Check the current Prisma major version's setup and pooler guidance before writing config.

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

The exact columns are decided in the first schema task. What is fixed is the shape, and the separations below exist for reasons. Do not add entities beyond this list without asking.

| Entity | Purpose |
|---|---|
| `profiles` | App-level user data keyed by the Supabase auth user id (plain uuid): chosen voice, speech rate, interests, preferred styles |
| `topics` | An idea for a story: title and style. Not tied to one user |
| `stories` | The finished result for a topic: text, audio object path, duration, TTS provider and voice. Created only when generation has succeeded. No owner column |
| `user_stories` | Per-user relationship to a story: queue position, progress state, and score |
| `generation_jobs` | One row per generation attempt chain: topic, requesting user, state, attempt count, last error |

Rules that follow from the reasoning:

- **Content is separate from per-user state.** `stories` has no owner, so a shared cache with tags can be added later without a migration. All per-user information lives in `user_stories`.
- **User intent and system health are separate axes.** What the person did with a story (`queued`, `listened`, `skipped`, `removed`) lives in `user_stories`. Whether the system managed to produce it (`pending`, `running`, `succeeded`, `failed`) lives in `generation_jobs`. They are never merged into one enum, because recovering from a failure must not lose what the person chose.
- **A story row exists only when complete.** There are no half-filled stories, so no nullable text or audio columns that apply to only one lifecycle stage.
- **Scores are recorded from day one.** Finishing a story counts as a positive signal and skipping early as a negative one, stored per user and story. The algorithm that uses them is deferred; the data is not.
- **Paths, not URLs.** Audio columns hold storage object paths. Signed URLs are created per request and never stored.

## 6. Generation pipeline

1. **Trigger.** After onboarding, when a user's unheard queue drops below a threshold, on a Cloud Scheduler top-up, or on an explicit user request, the API creates `generation_jobs` rows and enqueues one Cloud Task per story.
2. **Dispatch.** Cloud Tasks calls an `/internal/*` endpoint with a Google OIDC token. The endpoint verifies the token before doing anything. Queue settings cap concurrent dispatches and rate.
3. **Idempotency.** The handler first checks the job. A job that already succeeded returns 200 without doing work, so retries never create duplicate stories.
4. **Text.** `LlmProvider` returns the story text and metadata as structured output, validated with Zod, and the length is checked against the TTS limit.
5. **Audio.** `TtsProvider` returns one audio file. The duration is read from it.
6. **Store.** The file is uploaded to the private bucket. In one database transaction the `stories` row and the `user_stories` queue row are created and the job is marked `succeeded`.
7. **Failure.** The handler returns a 5xx and Cloud Tasks retries with backoff. After the maximum number of attempts the job is marked `failed` and nothing is added to the person's queue.

Delivery to the phone: the app asks the API for its queue, receives short-lived signed URLs, downloads the audio files, and plays local files. It reports progress events (finished, skipped) back to the API.

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
- The recommendation algorithm that uses scores. Only the recording of scores is in scope.
- Explicit ratings. They would be shown in the morning, not at night. Implicit signals are enough for now.
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
6. **Prisma and the pooler.** Confirm current setup and pooler configuration for the installed major version, including connections from Cloud Run.
7. **Local development of Cloud Tasks.** Choose between an emulator and a development-only direct call path for the internal endpoints.
8. **Cost control.** There is no per-user quota design yet. Every path that reaches a paid provider needs one before launch. Vendor-side spending caps should also be set.
9. **Sign-in provider setup.** Google and Apple configuration, redirect URIs, and the App Store sign-in expectation noted in section 8.
10. **Supabase Free tier.** Projects pause after a week of inactivity. Fine for development; not for a launch.
11. **Workspace naming.** The default `@org` package scope has not been renamed.
