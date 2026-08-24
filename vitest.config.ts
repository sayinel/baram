import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Vitest ignores vite.config.ts when this file exists — mirror the
  // @ alias so tests resolve imports the same way the app build does.
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Vitest stubs every CSS import with an empty string by default — INCLUDING
    // `?raw`, which is how the export builds its stylesheet from the editor's
    // own CSS (utils/export/export-editor-css.ts). With the default, every
    // assertion about what an export looks like reads an empty sheet and passes
    // vacuously; the old export-html test even said so in its own name ("raw
    // import may be empty in test env"). Processing CSS costs a little
    // transform time and buys back the only coverage the exported stylesheet
    // has.
    css: true,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
