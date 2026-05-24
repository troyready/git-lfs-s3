/**
 * Eslint configuration
 *
 * @packageDocumentation
 */

// @ts-check

// import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default defineConfig([
  {
    ignores: ["dist/", "node_modules/"],
  },
  ...tseslint.configs.recommended,
  prettierRecommended,
]);

// export default tseslint.config(
//   {
//     ignores: ["dist/", "node_modules/"],
//   },
//   eslint.configs.recommended,
//   tseslint.configs.recommended,
//   prettierRecommended
// );
