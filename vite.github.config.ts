import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "github-pages",
  base: "./",
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname) } },
  build: {
    outDir: "../github-dist",
    emptyOutDir: true,
  },
});
