import { builtinModules } from "node:module";
import baseConfig from "../../eslint.config.mjs";

const message = "contracts runs in the mobile app and the API: only zod is allowed";

// @nx/enforce-module-boundaries (root config) restricts npm packages to zod, but
// it does not see Node built-ins. This core rule covers them. Exact names in
// `paths` (not `patterns`) so a future relative file such as "./url" is not
// mistaken for the built-in "url".
const nodePaths = builtinModules.map((name) => ({ name, message }));
const nodePattern = { group: ["node:*"], message };

// Which folders of src each folder may import from (README.md, "Dependencies").
// `server` is not listed: it may import from any folder.
const allowedImports = {
    common: ["common"],
    preferences: ["preferences", "common"],
    queue: ["queue", "common", "preferences"],
    topics: ["topics", "common", "preferences"],
    listens: ["listens", "common", "preferences"]
};
const domains = [...Object.keys(allowedImports), "server"];

// ESLint replaces the options of a rule instead of merging them, so every block
// that sets no-restricted-imports must repeat the Node ban.
const restrictedImports = (extraPatterns = []) => ({
    "no-restricted-imports": [
        "error",
        { paths: nodePaths, patterns: [nodePattern, ...extraPatterns] }
    ]
});

// A module lies in src/<domain>/<module>/, so another domain is always two or
// more levels up. One "../" is a sibling module of the same domain.
const domainBoundaries = Object.entries(allowedImports).map(([domain, allowed]) => {
    const forbidden = domains.filter((other) => !allowed.includes(other));
    return {
        files: [`**/src/${domain}/**/*.ts`],
        rules: restrictedImports([
            {
                regex: `^(\\.\\./){2,}(${forbidden.join("|")})(/|$)`,
                message: `${domain} may import only from: ${allowed.join(", ")} (see README.md, "Dependencies")`
            }
        ])
    };
});

export default [
    ...baseConfig,
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: restrictedImports()
    },
    ...domainBoundaries
];
