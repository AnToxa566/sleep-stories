# contracts

Zod schemas and the types inferred from them for everything that crosses the API boundary: request and response bodies, the claims read from an access token, error bodies and shared enums. The mobile app and the API both import them from `@sleep-stories/contracts`, so there is one source of truth for the shape of the data.

## Rule: only zod

This package imports nothing except `zod`, because it must run in the mobile app and in the API alike. Two lint mechanisms enforce it:

- `@nx/enforce-module-boundaries` (root `eslint.config.mjs`): tag `scope:shared` may depend on no other project and on no npm package except `zod`.
- `no-restricted-imports` (`eslint.config.mjs` in this folder): blocks Node built-ins (`fs`, `node:crypto`, ...), which the Nx rule does not see.

## Tests

```sh
npx nx test contracts
npx nx lint contracts
npx nx typecheck contracts
```
