import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist", "coverage"] },
  {
    files: ["src/api/dashboard.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        Node: "readonly",
        clearTimeout: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
