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
      // Vite mini-app — has its own toolchain and routing model. The Next.js
      // ESLint preset doesn't apply (e.g. `<a href="/">` is correct here, not
      // a missing `next/link` import). Linted separately via the vite-app's
      // own setup if needed. Added in v2.14.10-3 after the showcase pages
      // started tripping `@next/next/no-html-link-for-pages`.
      "contract-app/**",
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
      // D1 incompatibility: inArray() silently returns wrong results on Cloudflare D1.
      // Use Promise.all(ids.map(id => db...where(eq(col, id)))).flat() instead.
      "no-restricted-imports": ["warn", {
        paths: [{
          name: "drizzle-orm",
          importNames: ["inArray"],
          message: "inArray() is broken on Cloudflare D1 — use Promise.all(ids.map(id => db...eq(id))).flat(). See docs/D1_COMPATIBILITY.md.",
        }],
      }],
    },
  },
];

export default eslintConfig;
