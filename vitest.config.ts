import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Vitest resolves .js extensions to .ts files automatically when
    // transforming; no alias needed.
  },
});
