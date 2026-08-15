import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? "/medantir-evidence/" : "/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
    host: true,
  },
}));
