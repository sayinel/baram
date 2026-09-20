import { defineConfig } from "vitest/config";

// Node, not jsdom: everything this plugin decides is decided on the DOCUMENT. The only
// DOM it produces is a class name the editor writes for it, and that is covered on the
// host side (src/plugins/__tests__/contributed-decorations.test.ts) against a real
// editor — which is the layer that actually catches a mistake here.
export default defineConfig({
  test: { environment: "node", include: ["src/__tests__/**/*.test.ts"] },
});
