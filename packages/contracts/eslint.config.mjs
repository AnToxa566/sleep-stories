import { builtinModules } from "node:module";
import baseConfig from "../../eslint.config.mjs";

const message = "contracts runs in the mobile app and the API: only zod is allowed";

export default [
    ...baseConfig,
    {
        // @nx/enforce-module-boundaries (root config) restricts npm packages to
        // zod, but it does not see Node built-ins. This core rule covers them.
        // Exact names in `paths` (not `patterns`) so a future relative file such
        // as "./url" is not mistaken for the built-in "url".
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: builtinModules.map((name) => ({ name, message })),
                    patterns: [{ group: ["node:*"], message }]
                }
            ]
        }
    }
];
