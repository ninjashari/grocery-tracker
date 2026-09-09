import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Separate from vite.config.ts, whose root is client/ — tests live at the repo root and
// cover shared/ and server/ as well.
export default defineConfig({
  resolve: {
    alias: { "@shared": `${root}shared` },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
