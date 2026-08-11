import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/medantir-evidence/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
