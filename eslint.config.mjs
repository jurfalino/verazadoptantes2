import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      // Utility scripts at root — CommonJS, not part of the app
      "check-db.js",
      "fix-db-column.js",
      "patch-db.js",
      "run-migration-0003.js",
      "scripts/**",
      "public/sw.js",
    ],
  },
  {
    rules: {
      // Downgrade to warnings — too pervasive to fix in one pass
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_|^e$|^err$|^error$",
      }],
      // Allow @ts-ignore alongside @ts-expect-error
      "@typescript-eslint/ban-ts-comment": "off",
      // Allow require() in edge cases (auth.ts dynamic imports)
      "@typescript-eslint/no-require-imports": "warn",
      // Using <img> is intentional — images are user-uploaded via R2 URLs
      "@next/next/no-img-element": "off",
      // Allow unescaped entities in JSX
      "react/no-unescaped-entities": "off",
      // Downgrade prefer-const
      "prefer-const": "warn",
    },
  },
];

export default eslintConfig;
