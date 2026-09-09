import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const apiPort = process.env.PORT ?? "5174";

export default defineConfig({
  root: "client",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": `${root}shared`,
    },
  },
  server: {
    port: 5173,
    // Bind on all interfaces so the app is reachable from a phone on the same wifi.
    host: true,
    // shared/ lives outside the Vite root, so it has to be explicitly allowed.
    fs: { allow: [root] },
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});
