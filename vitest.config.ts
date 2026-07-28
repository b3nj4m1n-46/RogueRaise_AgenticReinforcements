import { defineConfig } from "vitest/config";

// `resolve.tsconfigPaths` lets tests import via the `@/*` alias (from tsconfig),
// same as app code — native in Vite, no extra plugin needed.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
