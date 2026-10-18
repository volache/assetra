import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// Errors are reserved for real bugs (undefined names, broken JSX). Style-level
// findings stay warnings so `npm run lint` never blocks on taste.
export default [
  { ignores: ["dist/**", "node_modules/**", "data/**", "tools/**", "supabase/functions/**"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-key": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^(_|React$)" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-undef": "error", "no-unused-vars": "warn" },
  },
];
