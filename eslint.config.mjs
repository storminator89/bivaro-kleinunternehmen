import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            "out/**",
            "build/**",
            "dist/**",
            "*.config.js",
            "*.config.mjs",
            "*.config.cjs",
        ],
    },
    {
        files: ["**/*.{js,jsx,ts,tsx}"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
                React: "readonly",
            },
        },
        plugins: {
            "@next/next": nextPlugin,
            react: reactPlugin,
            "react-hooks": reactHooksPlugin,
            "@typescript-eslint": typescriptPlugin,
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            // Next.js rules
            ...nextPlugin.configs.recommended.rules,
            ...nextPlugin.configs["core-web-vitals"].rules,

            // React rules
            "react/react-in-jsx-scope": "off",
            "react/prop-types": "off",
            "react/jsx-uses-react": "off",

            // React Hooks rules
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",

            // TypeScript rules
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-empty-object-type": "off",

            // General rules
            "no-console": ["warn", { allow: ["warn", "error"] }],

            // Enforce the Prisma client singleton (`@/lib/prisma`).
            // Instantiating `new PrismaClient()` outside of `lib/prisma.ts`
            // leaks DB connections under HMR and across serverless invocations.
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "NewExpression[callee.name='PrismaClient']",
                    message:
                        "Do not instantiate PrismaClient directly. Import the singleton: `import { prisma } from '@/lib/prisma'`.",
                },
            ],
        },
    },
    {
        // The singleton itself is the one place where `new PrismaClient()` is allowed.
        files: ["lib/prisma.ts"],
        rules: {
            "no-restricted-syntax": "off",
        },
    },
];

export default eslintConfig;
