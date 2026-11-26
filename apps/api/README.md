# api

The NestJS API. What it does and why is in `ARCHITECTURE.md` sections 4 to 6; this file says where code goes inside `src/app`.

The layout takes from domain-driven design the grouping by meaning and the one-way dependencies. It does not take repositories, entities, aggregates or per-module `domain` / `application` / `infrastructure` layers: much of the logic is set-based SQL (the privacy rules included) and what must stay consistent is protected by transactions, database constraints and the lock on the person's `users` row. The whole API is one bounded context.

## Layout

| Folder | What belongs there |
|---|---|
| `platform` | The technical base with no feature in it: auth, environment config, the Prisma service and `lockUserRow`, the error body, response validation |
| `providers` | Adapters of paid or secret-bearing SDKs: LLM, TTS, storage, job queue |
| `preferences` | The person and their settings: `/me`, onboarding, the `users` row, interests, voices |
| `listens` | The listening history: the listen report, the rule of a heard story, removing that mark |
| `generation` | Making stories: limits, job records, the start plan, story state, the content services and the prompts |
| `topics` | The topic list, what a person may be offered (`candidates`), topics on request |
| `queue` | The night queue and the actions on it, the explicit start of generation included |
| `internal` | What Cloud Tasks and Cloud Scheduler call: OIDC check, the job runner and sweeper, the job handlers |

A folder groups by meaning, not by kind of code: there are no `services`, `controllers`, `repositories` or `utils` folders. `app.module.ts`, the health controller and `architecture.spec.ts` stay in `src/app`.

## Dependencies

| Folder | May import from (besides itself) |
|---|---|
| `platform` | nothing |
| `providers` | `platform` |
| `listens` | `platform` |
| `generation` | `providers`, `platform` |
| `topics` | `listens`, `generation`, `providers`, `platform` |
| `queue` | `topics`, `listens`, `generation`, `providers`, `platform` |
| `preferences` | `queue` (onboarding starts the top-up), `providers`, `platform` |
| `internal` | `queue`, `generation`, `providers`, `platform` |

- Nothing imports from `internal`; only `app.module.ts` does.
- `no-restricted-imports` in `eslint.config.mjs` of this folder enforces the table (the `allowedImports` map) for relative imports. A change of the table changes the map in the same commit. Specs are not checked: they wire several folders together.
- The check matches a folder name after `../`, so no folder inside a domain may be called `platform`, `providers`, `preferences`, `listens`, `generation`, `topics`, `queue` or `internal`.
- A cycle is not fixed by widening the table. Move the shared thing down, or compose the two calls in the folder above.
- A constant belongs to the folder that owns its rule (`queue/policy`, `generation/policy`, `providers/job-queue/job-lease.ts`), not to one shared file.

## Inside a folder

- Each concept or use case has its own folder (`queue/rebuild`, `topics/candidates`) with its code and specs.
- The Nest module, the controller, its DTOs and the specs of the whole feature (the HTTP integration spec) lie at the root of the domain folder. In `preferences` each part with its own Nest module (`me`, `interests`, `voices`, `users`) keeps those inside its folder.
- A spec lies next to the code it tests. Integration specs end in `.int-spec.ts`.
- No `index.ts` barrels: import a file directly.
- Keep a rule that needs no Nest and no database in a file of its own (`generation-start-plan.ts`, `top-up-plan.ts`, `queue-order.ts`), so it can be tested without either.

## Who writes what

- `queue_items` is written only by `queue`. Anything that adds to the end of a queue calls `appendToQueue`.
- The `users` row is locked only through `lockUserRow`.
- A `write_story` or `render_audio` payload is written only in `generation-start-plan.ts` and `write-story.handler.ts`. `architecture.spec.ts` checks this and the lock; its allow-lists hold file paths, so they move with the files.
- Files of the core zone are listed by path in `AGENTS.md` ("Slices and reviewability"). Moving one of them changes that list in the same commit.

## Checks

```sh
npx nx lint api
npx nx typecheck api
npx nx test api
npx nx test-integration api   # needs the local Supabase stack; run it after changing module wiring
```
