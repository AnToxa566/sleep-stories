import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

export default [
    ...nx.configs["flat/react"],
    ...baseConfig,
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        // Override or add rules here
        rules: {}
    },
    {
        // The shared components know nothing about a feature (src/ui/README.md,
        // "Dependencies"). A file lies in src/ui/<group>/, so a path that goes two or more
        // levels up leaves ui; from there only theme and the strings module are allowed.
        files: ["**/src/ui/**/*.ts", "**/src/ui/**/*.tsx"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            regex: "^(\\.\\./){2,}(?!(theme|strings)(/|$))",
                            message: "ui may import only from ui, theme and strings (see src/ui/README.md)"
                        }
                    ]
                }
            ]
        }
    },
    {
        ignores: [
            ".expo",
            "web-build",
            "cache",
            "dist"
        ]
    }
];
