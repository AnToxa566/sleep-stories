# Sleep Stories

A bedtime app that plays a queue of short, AI-generated stories and lectures in a calm Russian-language voice, so you can fall asleep to something quietly interesting and never have to pick up the phone to keep it going.

> **Status: early bootstrap.** The workspace contains a NestJS "Hello API" and the default Expo screen. They are not connected to each other yet. See [Current state](#current-state).

## Why it exists

Falling asleep is easier with a calm voice talking about something mildly interesting in the background. General-purpose AI voice chats do this badly in Russian: the speech engine is tuned for English and sounds accented, and when a lecture ends you must unlock the phone, pick a new topic and say it aloud, which wakes you up right when you were about to fall asleep.

Sleep Stories is built around that one scenario. Tonight's queue (usually two or three stories of about three minutes each) is prepared and downloaded in advance, plays without a connection, and at the end the app asks aloud "Вы спите?". One spoken word keeps the night going; silence lets it end.

## Engineering problems worth solving here

- **Staying alive in the background.** Audio has to keep playing with the screen off, and after the last story the app must open the microphone and listen. Both iOS and Android restrict exactly this. It is the riskiest part of the project and is still an open spike (see [Known open problems](ARCHITECTURE.md#11-known-open-problems)).
- **A durable, cheap generation pipeline.** Topic, LLM text, TTS audio, storage: driven by a queue with retries and rate limits on Cloud Run, so tonight's stories already exist and tomorrow's are being prepared while you listen.
- **Hearing one word without sending your room to the cloud.** The answer to "Вы спите?" is detected on the device. Microphone audio is never uploaded.
- **A phone that stays quiet.** Silencing notifications from inside the app needs a native module and explicit permission on Android, and is not possible at all on iOS.
- **Personalisation from behaviour and ratings, not forms.** How long a person listened to each story, and an optional rating of -1 or 1, are recorded per user and story from day one, so recommendations can be added later without a data migration.

## Stack

| Area | Choice |
|---|---|
| Monorepo | Nx, npm, TypeScript (strict) |
| Mobile | Expo (React Native), TanStack Query, Zustand + MMKV |
| API | NestJS on Google Cloud Run |
| Database | Supabase Postgres, Prisma |
| Auth | Supabase Auth (email, Google, Apple) |
| Background jobs | Google Cloud Tasks + Cloud Scheduler |
| Text generation | Anthropic SDK, behind an `LlmProvider` interface |
| Speech synthesis | Provider chosen after listening to Russian samples, behind a `TtsProvider` interface |
| File storage | Supabase Storage (private bucket, signed URLs) |
| Shared contracts | Zod schemas in `packages/contracts` |

Every choice, with its reasoning and cost, is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Repository layout

```
apps/api              NestJS API (deployed to Cloud Run)
apps/mobile           Expo (React Native) app
packages/contracts    Planned: Zod schemas shared by both apps
.claude/              Subagents and the /feature command (see AGENTS.md)
```

## Getting started

Developed on Node.js 22 with npm. Running on an iOS simulator needs Xcode (macOS); an Android emulator needs Android Studio.

```sh
npm install

# API database settings: copy apps/api/.env.example to apps/api/.env and fill it in
# (DATABASE_URL for the running API, DIRECT_URL for the Prisma CLI). The file is git-ignored.

# API: http://localhost:3000/api responds with {"message":"Hello API"}
npx nx serve api

# Database (Prisma): generate the client, create or apply migrations, check status
npx nx prisma-generate api
npx nx prisma-migrate-dev api -- --name <name>
npx nx prisma-migrate-deploy api
npx nx prisma-migrate-status api

# Mobile
npx nx start mobile        # Metro bundler with a QR code for Expo Go
npx nx run-ios mobile      # iOS simulator
npx nx run-android mobile  # Android emulator
```

Expo Go is enough for the current default screen only. Background audio, MMKV, local speech recognition and the Do Not Disturb module need native code, so a development build (EAS Build) is required as soon as the player work starts.

## Documentation

| File | What it is |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, boundaries, data model, decisions with reasoning, what is deferred, and the open problems |
| [SECURITY.md](SECURITY.md) | Threat model, security rules, and the pre-launch checklist |
| [AGENTS.md](AGENTS.md) | Rules and conventions for coding agents (`CLAUDE.md` points to it) |

## Development workflow

Non-trivial changes go through a four-role cycle defined in `.claude/`: a read-only planner, an executor, an adversarial reviewer in a fresh context, and an architect. Run it with `/feature <task>` in Claude Code. The plan is approved by a person before any file is touched, and the commit is made by a person after both verdicts. Details are in [AGENTS.md](AGENTS.md).

## Current state

- `apps/api`: NestJS app that returns `{"message":"Hello API"}` at `/api`. It connects to Supabase Postgres through Prisma 7 and checks the connection at boot; the environment is validated and a missing `DATABASE_URL` stops the process. The 14-table schema and first migration are in `apps/api/prisma`.
- `apps/mobile`: Expo app showing the default screen.
- Not connected to each other. No auth, no shared package, no deployment, no seed data.
- The Nx workspace was generated with the default `@org` package scope, which has not been renamed yet.

---

Built on [Nx](https://nx.dev).
