# Security

Sleep Stories handles user accounts, a listening history and paid third-party API keys (LLM and speech synthesis). This document records the threat model, the rules that follow from it, and what has to be true before launch.

The app does not use the microphone at present: the owner replaced listening for a spoken answer with a manual touch on 2026-10-29 (ARCHITECTURE.md, sections 7 and 10). The microphone rows below and rule 6 stay in force, unchanged, in case that is ever reopened.

Nothing is deployed yet. The only secrets are the cloud development database connection strings in the git-ignored `apps/api/.env` (the local values in that file are public CLI defaults); none are committed. Everything marked "planned" is a requirement for the code that will be written, not a description of existing behaviour.

## Assets

| Asset | Why it matters |
|---|---|
| Provider keys (Anthropic, TTS, Supabase service role, database URL) | Anyone holding them can spend money or read all data |
| User accounts and sessions | Access to a person's profile and history |
| Listening history and interests | Personal data about a person's evenings and tastes |
| Microphone audio (not captured at present) | Would be captured in a bedroom; the most sensitive input the app could touch |
| The generation pipeline | Each run costs money; abuse becomes a bill |

## Threat model

| Threat | Impact | Mitigation | Status |
|---|---|---|---|
| Provider keys end up in the mobile bundle, the contracts package, logs, prompts or error responses | Account takeover of providers, large bills | Keys exist only on the server (Secret Manager in production, git-ignored env locally); mobile holds only the Supabase URL and publishable key | Planned |
| One user reads or changes another user's data | Privacy breach | User id comes only from the verified JWT; every query on user data is scoped by it; ownership is never taken from the request body, query or headers | Planned |
| The client talks to the database directly with its publishable key | Data exposure | RLS is enabled on every table with no policies, so client roles get nothing; all data goes through the API | Planned |
| Forged calls to `/internal/*` endpoints | Free generation at the owner's expense | Every internal endpoint verifies a Google OIDC token (expected audience and service account); a user JWT is not accepted there | Planned |
| Spamming generation to run up the bill | Cost abuse | Per-user limits checked before any provider call, queue-level rate and concurrency caps, `@nestjs/throttler`, spending caps in the vendor accounts | Open: no quota design yet |
| A story made from one person's typed text is shown to another person | Leak of personal text, or of anything hostile that was typed | Reuse of stories between people (ARCHITECTURE.md, section 6) takes only topics proposed by the system, never one with a `requested` `user_topics` row (rule 10); a custom interest is used only for its own person's topic list | Planned: no code yet |
| Prompt injection through custom topics | Odd or unsafe story content | Topic text is untrusted data, passed as delimited user content and never mixed into system instructions; no secrets appear in prompts; model output is plain text and is never executed or used to pick tools or URLs | Planned |
| Microphone audio is uploaded or stored | Severe privacy breach | Detection and recognition are local; nothing on the audio path makes a network call; nothing is recorded to disk beyond what local recognition needs in memory. If the microphone is reopened: `expo-audio` can only meter by recording to a file (the cache directory by default), so that file must be deleted as soon as recording stops and must not be backed up | Not applicable while the microphone is unused |
| Signed URLs leak or are reused | Unauthorised file access | Private bucket; URLs are short-lived and created per request; the database stores object paths only | Planned |
| Database traffic intercepted or downgraded to plaintext | Credentials and user data exposed to a network attacker | Runtime connection verifies the pooler certificate against a pinned Supabase root CA; `DATABASE_URL` may not carry `ssl*` options that override it; `rejectUnauthorized: false` is never used. The Prisma CLI connection is opportunistic TLS, unverified (open) | Runtime done, CLI open |
| The local Supabase stack is reachable from the local network | The Supabase CLI publishes four ports on all interfaces (verified with `docker ps`): 54321 (the API gateway; its default service-role key is public and bypasses RLS), 54322 (Postgres, password `postgres`), 54323 (Studio, an unauthenticated SQL and admin interface) and 54324 (the mail catcher). Anyone on the same network can read and change the local database; it holds development data only | Trusted networks only; stop the stack after work with `npx nx supabase-stop api`; never run the stack on public Wi-Fi. The cloud credentials are not reachable through these ports: they exist only in the git-ignored `apps/api/.env`, commented out while the local stack is in use | Accepted for local development |
| Account enumeration: sign-up reveals whether an email is registered | An attacker can test a list of addresses against the app (privacy leak, input for phishing and credential stuffing) | With email confirmation off, Supabase Auth must answer a sign-up for an existing address with `user_already_exists`, and the app shows "account already exists" (`strings.auth.errors.userAlreadyExists`). Hiding the text in the app would not help: the publishable key is public, so anyone can call `/auth/v1/signup` directly. The fix is email confirmation: Supabase then answers an existing address like a new one (an obfuscated user without identities) and mails the owner of the address; the sign-up screen already handles that answer (`CredentialsForm.tsx`) and must show the same "check your mail" text for both cases. Sign-in is not affected: a wrong email and a wrong password give the same `invalid_credentials`. Also rely on Supabase Auth rate limits | Accepted for the local, pre-launch iteration (decided 2026-10-29); closed by the email confirmation checklist item |
| Account takeover through weak sign-in setup | Access to someone's profile | Supabase Auth settings reviewed, OAuth redirect URIs on an allowlist, email confirmation on | Planned |
| Secrets or personal data in logs | Leakage through log access | Structured logging with redaction; no tokens, emails or story text in logs | Planned |
| Vulnerable dependencies | Supply-chain compromise | Lockfile committed, versions pinned, few dependencies, review of audit results before launch | Open: see current state |
| Secrets or server code leave with an EAS build archive | EAS uploads the repository root to Expo's servers on every mobile build | Secrets live only in git-ignored files, and EAS is documented to skip what `.gitignore` ignores, so the git-ignored `.env` files should stay out. The archive contents of the first builds were not inspected, so neither that nor whether `apps/api` travels with it is verified; an `.easignore` is the candidate fix and has not been tried (ARCHITECTURE.md section 11, item 22) | Open |

## Security rules

These are non-negotiable and are copied verbatim into the executor agent.

1. Provider keys (Anthropic, TTS, Supabase service role, database URL) exist only on the server: Secret Manager in production, a git-ignored env file locally. They never appear in `apps/mobile`, `packages/contracts`, logs, prompts or error responses. The mobile app holds only the Supabase URL and publishable key.
2. The API trusts only the user id from a verified Supabase JWT. Never take a user id, role or ownership from the request body, query or headers. Every query on user data is scoped by that id.
3. Every table has RLS enabled and no policies. The mobile app never queries Supabase tables directly. Storage buckets are private, and the app only receives short-lived signed URLs from the API.
4. Every `/internal/*` endpoint verifies a Google OIDC token with the expected audience and service account before doing anything. A user JWT is not accepted there.
5. All data crossing a boundary goes through a Zod schema from `packages/contracts`: request bodies, response bodies and structured LLM output. No `any` at a boundary.
6. Microphone audio never leaves the device. No upload, no cloud speech-to-text, no network call on the audio path.
7. User-written topic text is untrusted data. It is never concatenated into system instructions. LLM output is treated as plain text and is never executed or used to choose tools, URLs or code paths.
8. The database stores storage object paths, never signed URLs. Signed URLs are short-lived and created per request.
9. No secrets, tokens, email addresses or story text in logs.
10. Text a person typed (a requested topic, a custom interest) and everything generated from it is never shown to anyone else. Stories are reused between people only when their topic was proposed by the system: no `user_topics` row for it has the reason `requested`. A custom interest is never put into another person's prompt.

## Current state

- No deployment. A cloud development Supabase database exists and holds the schema from the first migration, with no data (it is one migration behind the local one). Its connection strings live only in the git-ignored `apps/api/.env` (commented out with the prefix `# cloud: ` while the local stack is in use); the cloud block of `apps/api/.env.example` holds placeholders, and its local block holds the public default values of the Supabase CLI, which are not secrets.
- A local Supabase stack (CLI 2.121.0, a pinned root dev dependency) runs in Docker and holds the same schema, applied by `prisma migrate deploy`. Email confirmation is off in it. It publishes ports 54321 to 54324 on all network interfaces (see the threat model). Its keys are the CLI's public defaults.
- RLS is enabled with no policies on all 14 tables and on `_prisma_migrations` (verified by querying `pg_class` and `pg_policies` after the migration). The pre-launch check with the publishable key has not been done yet.
- The environment schema rejects a missing or malformed `DATABASE_URL` at boot without echoing its value, and rejects a `DATABASE_URL` that sets any `ssl*` option, so the connection string cannot weaken TLS.
- Runtime database traffic uses verified TLS: `PrismaService` checks the pooler certificate against Supabase's root CA pinned in the repository (expires 2031-04-26, rotated by hand). Verified by booting the API with it.
- Migration traffic (the Prisma CLI over `DIRECT_URL`) uses opportunistic TLS (like `sslmode=prefer`) and the certificate is not verified; an active network attacker could strip TLS or intercept it. This is an open item (ARCHITECTURE.md section 11) and affects development machines and CI only, not the running service.
- When the workspace was first generated for testing (2026-10-08), `npm install` reported dozens of vulnerabilities in the scaffold's dependency tree (83 in that run). They have not been triaged. Check the current `npm audit` output, and decide what matters, before any launch.
- The module-boundary lint rule is on (tags `scope:mobile`, `scope:api`, `scope:shared`; Node built-ins are also forbidden in `packages/contracts`); proven by adding a forbidden import and watching lint fail.
- Authentication (2026-10-29, local stack only): a global guard rejects every request without a valid Supabase access token (deny by default; only `@Public()` routes are open). Only ES256 and RS256 are accepted, issuer and audience are checked, the user id comes only from `sub`, and a body field such as `userId` is rejected by the strict schemas. A real token from the local stack was used to check this end to end, and a two-user integration test checks that users never see each other's data. The code logs only error classes; reading real log output for tokens and emails is still on the checklist.
- The mobile session is stored encrypted: AES-256-GCM with a fresh key per write, the blob in a file and the key in `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). A 401 from the API signs the user out locally. The mobile app holds only the Supabase URL and the publishable key, and its environment check rejects a `sb_secret_` key. Not yet checked: the built bundle has not been searched for provider keys, and the logout path was checked by hand only.
- Plaintext database connections exist only for the local stack: `DATABASE_TLS=disabled-local-only` is accepted only for a loopback host, outside production and outside Cloud Run, and the API refuses to start otherwise (unit-tested).
- Account enumeration: sign-up reveals that an address is registered while email confirmation is off (see the threat table); accepted for now.
- `apps/mobile` is on Expo SDK 57 and linked to an EAS project (`owner` and `projectId` in `app.json`; neither is a secret). It has no `expo-audio`, no microphone permission and no authentication. The background-audio spike lives only on the branch `spike/background-audio` and is not merged.

## Pre-launch checklist

- [ ] Per-user quota exists and is enforced before every call to the LLM and TTS providers
- [ ] Spending caps are set in the Anthropic, TTS and Google Cloud accounts
- [ ] RLS is enabled on every table; verified by querying with the publishable key and getting nothing
- [ ] Storage buckets are private; verified by requesting a file URL without a signature and getting a refusal
- [ ] `/internal/*` endpoints reject requests without a valid OIDC token; verified by calling one without it
- [ ] The API rejects a request that names another user's id; verified with two test accounts
- [ ] Missing required configuration crashes the process at boot; verified by starting it without a secret
- [ ] No provider key appears in the mobile bundle; verified by searching the built bundle
- [ ] The built app declares no microphone permission (no `RECORD_AUDIO` in the Android manifest, no `NSMicrophoneUsageDescription` in `Info.plist`) while the microphone is unused; verified in the built APK and IPA
- [ ] Only if the microphone is reopened: nothing on the microphone audio path opens a network connection, and no recording file is left on the device; verified by reading the code path, by watching network traffic and by listing the app's files after a night
- [ ] What an EAS build archive contains has been inspected, and no secret or server-only file is in it
- [ ] Logs contain no tokens, emails or story text; verified by reading real log output
- [ ] Email confirmation is on in the cloud Supabase project (it is off in the local stack); verified by signing up and being refused sign-in before confirming the address. This is also the fix for account enumeration: verified by signing up with an existing address and with a new one, and getting the same screen and the same text for both (the app must not show "account already exists")
- [ ] Sign-in providers are configured with allowlisted redirect URIs; the App Store sign-in expectation is checked
- [ ] The Supabase project is not on a plan that pauses for inactivity
- [ ] `npm audit` results have been reviewed and the remaining findings accepted explicitly
- [ ] Module-boundary lint rule is on and proven by violating it on purpose
- [ ] In-app account deletion works end to end (the Supabase auth user and the `users` row with its cascade); the App Store expects it
