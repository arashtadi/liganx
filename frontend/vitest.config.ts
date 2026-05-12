// Vitest config — runs in jsdom so React components can mount.
// Companion to vite.config.ts; vitest reuses the @vitejs/plugin-react
// chain so JSX/TSX is transformed the same way the production build
// transforms it. globals=true lets tests use `describe`/`it`/`expect`
// without per-file imports (matches the Jest convention most React
// developers expect).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    css: false,
    // Exclude the 3Dmol / Ketcher bundles from coverage — they're
    // CDN-loaded, can't run in jsdom anyway, and their absence shouldn't
    // turn smoke tests red.
    exclude: ["node_modules", "dist", ".vercel"],
  },
});
