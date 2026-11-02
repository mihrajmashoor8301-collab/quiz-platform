import { defineConfig } from "vitest/config";

export default defineConfig({
  include: ["backend/**/*.test.js", "frontend/**/*.test.tsx"],
  globals: true,
  restoreMocks: true,
  coverage: {
    provider: "v8",
    reporter: ["text", "json", "html"],
    exclude: ["backend/node_modules", "frontend/node_modules", "backend/dist", "frontend/dist"],
    thresholds: {
      global: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
