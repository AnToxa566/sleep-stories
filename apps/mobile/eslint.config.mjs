import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

// Which other features each feature may import from (src/features/README.md,
// "Dependencies"). A new cross-feature import is added here on purpose or not made.
const allowedFeatures = {
    auth: [],
    gate: ["auth"],
    onboarding: ["auth"],
    today: ["auth", "topics"],
    topics: ["auth"],
    player: ["auth"],
    settings: ["auth"]
};
const features = Object.keys(allowedFeatures);

// A relative path that goes up and then names another feature. It relies on no folder inside
// a feature being called like a feature.
const featureBoundaries = Object.entries(allowedFeatures).map(([feature, allowed]) => {
    const forbidden = features.filter((other) => other !== feature && !allowed.includes(other));
    return {
        files: [`**/src/features/${feature}/**/*.ts`, `**/src/features/${feature}/**/*.tsx`],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            regex: `^(\\.\\./)+(features/)?(${forbidden.join("|")})(/|$)`,
                            message: `features/${feature} may import from these other features only: ${allowed.join(", ") || "none"} (see src/features/README.md)`
                        }
                    ]
                }
            ]
        }
    };
});

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
    ...featureBoundaries,
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
