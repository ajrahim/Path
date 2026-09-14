import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const rendererFiles = ["apps/renderer/**/*.{ts,tsx,mts,cts}"];

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/dist/**",
    "**/next-env.d.ts",
    "release/**",
    "coverage/**",
    "work/**",
    "outputs/**",
    "apps/desktop/vendor/**",
    "packages/database/drizzle/**",
  ]),
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
  ...nextVitals
    .filter((config) => !config.ignores)
    .map((config) => ({ ...config, files: rendererFiles })),
  ...nextTs.map((config) => ({ ...config, files: rendererFiles })),
  { settings: { next: { rootDir: "apps/renderer/" } } },
  prettier,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      curly: ["error", "multi-line", "consistent"],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      // Prettier preserves blank lines; lint enforces the baseline between code phases.
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        {
          blankLine: "always",
          prev: ["multiline-const", "multiline-let", "multiline-var"],
          next: "*",
        },
        { blankLine: "always", prev: "*", next: ["return", "throw"] },
        { blankLine: "always", prev: "block-like", next: "*" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);
