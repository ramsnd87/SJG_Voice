import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  root: "src/renderer",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8044",
    },
  },
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
