import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
        ignores: [
            "**/dist",
            "**/out-tsc"
        ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: [
                        "^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"
                    ],
                    // ARCHITECTURE.md section 3. The apps import only the shared
                    // contracts and never each other (tag constraints).
                    // allowedExternalImports whitelists the npm packages that
                    // scope:shared may import (zod). It does not see Node
                    // built-ins such as "fs" or "node:crypto"; those are blocked
                    // by no-restricted-imports in packages/contracts/eslint.config.mjs.
                    depConstraints: [
                        {
                            sourceTag: "scope:mobile",
                            onlyDependOnLibsWithTags: [
                                "scope:shared"
                            ]
                        },
                        {
                            sourceTag: "scope:api",
                            onlyDependOnLibsWithTags: [
                                "scope:shared"
                            ]
                        },
                        {
                            sourceTag: "scope:shared",
                            onlyDependOnLibsWithTags: [],
                            allowedExternalImports: [
                                "zod"
                            ]
                        }
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
