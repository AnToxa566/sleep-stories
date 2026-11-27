# features

The parts of the app, one folder each. A route in `src/app` puts them on a screen and may use any of them.

| Feature | What belongs there |
|---|---|
| `auth` | Sign-up, sign-in and the encrypted persistent session. The whole folder is in the core zone (AGENTS.md) |
| `gate` | Where a person is sent after launch |
| `onboarding` | The three steps after sign-up |
| `today` | «Сегодня»: the night queue, the main button, its progress and sheets |
| `topics` | «Темы» and the topic picker of «Замена»: the list, its filters, topics on request |
| `player` | The night player |
| `settings` | «Настройки»: the rows with the person's choices and account, sign-out; the screens «Рассказчик» (`narrator/`) and «Интересы» (`interests/`) |

## Inside a feature

- Files are grouped by the part of the feature (`today/main-button`, `player/seek-bar`), not by kind of code: there are no `components`, `hooks` or `utils` folders. A component, its logic and its spec lie together.
- The root of a feature holds only its entry (`player/PlayerScreen.tsx`) or what the whole feature shares (`onboarding/onboarding-store.ts`). `today/queue-rule-10.spec.ts` stays at the root of `today`: it guards the whole app.
- A spec lies next to the file it tests. No `index.ts` barrels: import a file directly.
- No folder inside a feature is called `auth`, `gate`, `onboarding`, `today`, `topics`, `player` or `settings`: the lint check matches those names.

## Dependencies

| Feature | May import from other features |
|---|---|
| `auth` | none |
| `gate` | `auth` |
| `onboarding` | `auth` |
| `today` | `auth`, `topics` (a queue change updates the cached topic list) |
| `topics` | `auth` |
| `player` | `auth` |
| `settings` | `auth` |

- `no-restricted-imports` in `apps/mobile/eslint.config.mjs` enforces the table (the `allowedFeatures` map) for relative imports. A change of the table changes the map in the same commit, and a new feature is added to both.
- What two features need and neither owns leaves the features: a cache key to `api/query-keys.ts`, the message for an API error to `api/error-toast.ts`, the formatting of numbers to `format`, a component without a feature to `ui` (`src/ui/README.md`).
- One known exception below the features: `api` reads the session from `features/auth`. Moving the session out would move core-zone code, so it stays there for now.

## The generation guard

`today/queue-rule-10.spec.ts` allows the calls that start a generation or a topic suggestion only in some places (AGENTS.md architecture rule 10). It names `features/today/`, `features/topics/` and `features/player/`, and the three query modules by their exact path. Moving one of those modules changes the spec in the same commit. Renaming a feature changes what the spec allows: ask the owner first. It is a text scan and cannot see an effect inside a component, so review those by eye.
