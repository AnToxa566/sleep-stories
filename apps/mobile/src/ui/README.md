# ui

The shared components of the app. What they look like follows `design/` and ARCHITECTURE.md section 9.

## What belongs here

A component belongs here when it makes sense without any particular feature. A component tied to one feature stays in that feature, and moves here when a second feature needs it. Having one user today is not enough to move a general component (a text field, a link) into a feature.

Two choices that follow from this:

- `buttons/PromptLink` is used by sign-in and sign-up only. It stays here because `features/auth` is in the core zone (AGENTS.md), and a plain link must not need that review.
- `status/HeardMark` knows what a heard story is. It stays here because two features show it.

## Layout

| Folder | What belongs there |
|---|---|
| `typography` | `Text` and `TextInput` in Onest. Every screen uses them; `typography.spec.ts` scans all of `src` for raw ones |
| `icons` | The icon set |
| `buttons` | What a person taps to do something or to go somewhere: buttons and links |
| `inputs` | What a person types into or chooses with: fields, chips, selectable rows |
| `voice` | The voice list with its loading and error states, and the playback of the voice samples |
| `interests` | The interest picker (catalogue and typed chips, the field for an own topic, loading and error states) and the pure rules of its entries |
| `story-styles` | The story styles as rows with checkboxes, for onboarding and «Настройки» |
| `layout` | What a screen is built on: the screen frame, the background, the bottom sheet |
| `status` | What shows a state and takes no taps: skeletons, marks |
| `toast` | The toast: its store and its host |
| `orb` | The orb: the component and its geometry |
| `navigation` | The tab bar and the stack options |
| `motion` | Hooks about animation |

- A simple component lies in the folder of its kind. A concept of several files gets a folder of its own (`toast`, `orb`). There is no folder per component: components have no specs (Jest runs pure TypeScript only), so most such folders would hold one file.
- No file lies directly in `ui`, and there are no `index.ts` barrels: import a file directly.
- A spec lies next to the file it tests.
- Copy is in `src/strings.ts`, colours and sizes are in `src/theme` (AGENTS.md rule 8).

## Dependencies

Of the app's own code, `ui` imports only from `ui`, `src/theme` and `src/strings.ts`, never from `features`, `app`, `api` or `config`. Like all of the app it may use the shapes of `@sleep-stories/contracts` (`interests` checks a typed topic with the schema the API uses); the data comes in through props. `no-restricted-imports` in `apps/mobile/eslint.config.mjs` enforces this for relative imports. The rule relies on every file lying exactly one folder deep (`ui/<folder>/<file>`).
