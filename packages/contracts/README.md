# contracts

Zod schemas and the types inferred from them for everything that crosses a boundary: request and response bodies, the claims read from an access token, error bodies, shared enums, job payloads and structured LLM output. The mobile app and the API both import from `@sleep-stories/contracts`, so there is one source of truth for the shape of the data.

## Rule: only zod

This package imports nothing except `zod`, because it must run in the mobile app and in the API alike. Two lint mechanisms enforce it:

- `@nx/enforce-module-boundaries` (root `eslint.config.mjs`): tag `scope:shared` may depend on no other project and on no npm package except `zod`.
- `no-restricted-imports` (`eslint.config.mjs` in this folder): blocks Node built-ins (`fs`, `node:crypto`, ...), which the Nx rule does not see.

## Layout

`src/<domain>/<module>/<module>.ts`, with `src/index.ts` as the only public entry point.

| Domain folder | What belongs there |
|---|---|
| `common` | What several domains need and none of them owns: primitives (slug), shared enums (story style), the API error body |
| `preferences` | The person's profile and settings: `/me`, onboarding, interests, voices |
| `queue` | The night queue and the actions on it |
| `topics` | The topic list and topic suggestion requested by the person |
| `listens` | Listen reports |
| `server` | What the app and the API do not exchange: access token claims, internal job endpoints, job payloads, structured LLM output |

A folder groups by meaning, not by kind of code: there are no `types`, `schemas`, `constants`, `requests` or `responses` folders.

## Where a new schema goes

1. Is it something the app and the API do not exchange (a token, a job payload, an internal endpoint, LLM output)? It goes to `server`, whatever its feature is.
2. Otherwise it goes to the domain it describes. The domain follows the meaning, not the URL and not the folders of `apps/api`.
3. Does it belong to no single domain and do several need it? It goes to `common`.
4. Add a new domain folder only when none of the existing ones fits, and add it to this file and to the dependency rules.

## Dependencies

| Folder | May import from |
|---|---|
| `common` | `common` |
| `preferences` | `preferences`, `common` |
| `queue` | `queue`, `common`, `preferences` |
| `topics` | `topics`, `common`, `preferences` |
| `listens` | `listens`, `common`, `preferences` |
| `server` | any folder |

- **Nothing imports from `server`.** The only exception is `src/index.ts`, which re-exports it.
- `queue`, `topics` and `listens` do not import from each other. What two of them need moves to `common`.
- The apps can still import `server` schemas through the package entry point: the folder marks the boundary inside this package and does not hide anything from the apps. Never put a secret here.

## Module folders

- Every module has its own folder with the same name, also when it has no test.
- A module folder holds the module and its spec, nothing else.
- One module is one topic. Its schemas, the types inferred from them and its constants stay together. Split a module when a second topic appears in it, not because of its line count; the new topic gets a sibling folder.
- The name says what is inside without the folder around it (`listen-report`, not `report`). Avoid a path that repeats one word three times.

## Shared schemas

A schema lives in the module of its own concept, not in the module that used it first. When a second module needs it, it imports it from there; if the dependency rules forbid that import, the schema moves to `common`.

## Imports and exports

- The apps import only from `@sleep-stories/contracts`, never from a path inside it.
- Inside the package, import a module directly by its relative path, never through `src/index.ts`.
- `src/index.ts` is the only `index.ts`: no barrels in domain or module folders. They add files and make import cycles easy.
- Export a new module in `src/index.ts`, in the group of its folder.

## Tests

A spec lies next to its module and has the same name (`slug.spec.ts` next to `slug.ts`). It moves, is renamed and is split together with the module. There are no `tests` or `__tests__` folders. A spec tests the schemas of its own module.

```sh
npx nx test contracts
npx nx lint contracts
npx nx typecheck contracts
```
