import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  /* The application imports itself through "@/", the same
     alias tsconfig declares, so tests can exercise those
     modules unchanged. */
  resolve: {
    alias: {
      "@": fileURLToPath(
        new URL(".", import.meta.url),
      ),
    },
  },

  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],

    coverage: {
      reporter: ["text", "html"],
      include: ["packages/domain/src/**/*.ts"],
    },
  },
});
