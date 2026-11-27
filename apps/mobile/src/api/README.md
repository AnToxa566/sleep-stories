# api

How the app talks to the API, and **only what more than one part of the app needs**. A query or a mutation that one feature alone uses lives in that feature, next to the code it serves (`features/today/queue-data/queue-queries.ts`, `features/settings/narrator/use-change-voice.ts`, `features/onboarding/completion/use-complete-onboarding.ts`). "It is one more hook" is no reason to add it here: that is how a single module of unrelated hooks grows (AGENTS.md Conventions, "Keep pieces of domain logic apart").

| Place | What belongs there |
|---|---|
| `http` | The transport: the API client (it sets the auth header, so that part is in the core zone), its errors and the configured `apiFetch` |
| `me` | The person's `/me`: its read and its cache key |
| `catalogue` | The reads that are the same for every person: interests and voices |
| the root | What the whole folder or several features share: the query client, the cache keys more than one feature reads or makes stale (`query-keys.ts`), the message for an API error (`error-toast.ts`) |

- A new concept that several features need gets its own folder. A hook never joins an unrelated one in a shared module, and there is no module that collects hooks.
- When a second feature starts to need something that lives in one feature, move it here; do not widen the feature boundaries for it (`src/features/README.md`).
- `api` does not import a feature. The one exception: it reads the session from `features/auth` (see `src/features/README.md`).
- No `index.ts` barrels: import a file directly.
