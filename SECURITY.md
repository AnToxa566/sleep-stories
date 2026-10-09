# Security

Sleep Stories handles user accounts, a listening history, a microphone permission, and paid third-party API keys (LLM and speech synthesis). This document records the threat model, the rules that follow from it, and what has to be true before launch.

Nothing is deployed yet. The only secrets are the development database connection strings in the git-ignored `apps/api/.env`; none are committed. Everything marked "planned" is a requirement for the code that will be written, not a description of existing behaviour.

## Assets

| Asset | Why it matters |
|---|---|
| Provider keys (Anthropic, TTS, Supabase service role, database URL) | Anyone holding them can spend money or read all data |
| User accounts and sessions | Access to a person's profile and history |
| Listening history and interests | Personal data about a person's evenings and tastes |
| Microphone audio | Captured in a bedroom; the most sensitive input the app touches |
| The generation pipeline | Each run costs money; abuse becomes a bill |

## Threat model

| Threat | Impact | Mitigation | Status |
|---|---|---|---|
| Provider keys end up in the mobile bundle, the contracts package, logs, prompts or error responses | Account takeover of providers, large bills | Keys exist only on the server (Secret Manager in production, git-ignored env locally); mobile holds only the Supabase URL and publishable key | Planned |
| One user reads or changes another user's data | Privacy breach | User id comes only from the verified JWT; every query on user data is scoped by it; ownership is never taken from the request body, query or headers | Planned |
| The client talks to the database directly with its publishable key | Data exposure | RLS is enabled on every table with no policies, so client roles get nothing; all data goes through the API | Planned |
| Forged calls to `/internal/*` endpoints | Free generation at the owner's expense | Every internal endpoint verifies a Google OIDC token (expected audience and service account); a user JWT is not accepted there | Planned |
| Spamming generation to run up the bill | Cost abuse | Per-user limits checked before any provider call, queue-level rate and concurrency caps, `@nestjs/throttler`, spending caps in the vendor accounts | Open: no quota design yet |
| Prompt injection through custom topics | Odd or unsafe story content | Topic text is untrusted data, passed as delimited user content and never mixed into system instructions; no secrets appear in prompts; model output is plain text and is never executed or used to pick tools or URLs | Planned |
| Microphone audio is uploaded or stored | Severe privacy breach | Detection and recognition are local; nothing on the audio path makes a network call; nothing is recorded to disk beyond what local recognition needs in memory | Planned |
| Signed URLs leak or are reused | Unauthorised file access | Private bucket; URLs are short-lived and created per request; the database stores object paths only | Planned |
| Database traffic intercepted or downgraded to plaintext | Credentials and user data exposed to a network attacker | Runtime connection verifies the pooler certificate against a pinned Supabase root CA; `DATABASE_URL` may not carry `ssl*` options that override it; `rejectUnauthorized: false` is never used. The Prisma CLI connection is opportunistic TLS, unverified (open) | Runtime done, CLI open |
| Account takeover through weak sign-in setup | Access to someone's profile | Supabase Auth settings reviewed, OAuth redirect URIs on an allowlist, email confirmation on | Planned |
| Secrets or personal data in logs | Leakage through log access | Structured logging with redaction; no tokens, emails or story text in logs | Planned |
| Vulnerable dependencies | Supply-chain compromise | Lockfile committed, versions pinned, few dependencies, review of audit results before launch | Open: see current state |

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

## Current state

- No deployment and no authentication. A development Supabase database exists and holds the schema from the first migration, with no data. Its connection strings live only in the git-ignored `apps/api/.env`; `apps/api/.env.example` holds placeholders.
- RLS is enabled with no policies on all 14 tables and on `_prisma_migrations` (verified by querying `pg_class` and `pg_policies` after the migration). The pre-launch check with the publishable key has not been done yet.
- The environment schema rejects a missing or malformed `DATABASE_URL` at boot without echoing its value, and rejects a `DATABASE_URL` that sets any `ssl*` option, so the connection string cannot weaken TLS.
- Runtime database traffic uses verified TLS: `PrismaService` checks the pooler certificate against Supabase's root CA pinned in the repository (expires 2031-04-26, rotated by hand). Verified by booting the API with it.
- Migration traffic (the Prisma CLI over `DIRECT_URL`) uses opportunistic TLS (like `sslmode=prefer`) and the certificate is not verified; an active network attacker could strip TLS or intercept it. This is an open item (ARCHITECTURE.md section 11) and affects development machines and CI only, not the running service.
- When the workspace was first generated for testing (2026-10-08), `npm install` reported dozens of vulnerabilities in the scaffold's dependency tree (83 in that run). They have not been triaged. Check the current `npm audit` output, and decide what matters, before any launch.
- The module-boundary lint rule is not configured yet (see ARCHITECTURE.md, section 3).

## Pre-launch checklist

- [ ] Per-user quota exists and is enforced before every call to the LLM and TTS providers
- [ ] Spending caps are set in the Anthropic, TTS and Google Cloud accounts
- [ ] RLS is enabled on every table; verified by querying with the publishable key and getting nothing
- [ ] Storage buckets are private; verified by requesting a file URL without a signature and getting a refusal
- [ ] `/internal/*` endpoints reject requests without a valid OIDC token; verified by calling one without it
- [ ] The API rejects a request that names another user's id; verified with two test accounts
- [ ] Missing required configuration crashes the process at boot; verified by starting it without a secret
- [ ] No provider key appears in the mobile bundle; verified by searching the built bundle
- [ ] Nothing on the microphone audio path opens a network connection; verified by reading the code path and by watching network traffic during a "Вы спите?" window
- [ ] Logs contain no tokens, emails or story text; verified by reading real log output
- [ ] Sign-in providers are configured with allowlisted redirect URIs; the App Store sign-in expectation is checked
- [ ] The Supabase project is not on a plan that pauses for inactivity
- [ ] `npm audit` results have been reviewed and the remaining findings accepted explicitly
- [ ] Module-boundary lint rule is on and proven by violating it on purpose
- [ ] In-app account deletion works end to end (the Supabase auth user and the `users` row with its cascade); the App Store expects it
