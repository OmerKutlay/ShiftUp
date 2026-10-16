import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Next 16: `next lint` kaldırıldı — ESLint CLI doğrudan çalıştırılır (npm run lint).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Biçimlendirme kurallarını Prettier'a bırak
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // Mevcut client-side veri çekme deseninde (effect içinde setState) yaygın; uyarı olarak izlenir
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", ".open-next/**", ".wrangler/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "public/sw-push.js", ".claude/worktrees/**", "playwright-report/**", "test-results/**"]),
]);
