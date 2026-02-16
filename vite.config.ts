import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // §8.4 Build optimization — vendor chunk splitting
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // ProseMirror + Tiptap core — editor essentials (always needed)
          "vendor-editor": [
            "@tiptap/core",
            "@tiptap/react",
            "@tiptap/pm/state",
            "@tiptap/pm/view",
            "@tiptap/pm/model",
          ],
          // CodeMirror core — code blocks / source mode only
          "vendor-codemirror": [
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/commands",
            "@codemirror/language",
          ],
          // KaTeX — math content only
          "vendor-katex": ["katex"],
          // Markdown pipeline — file open/save
          "vendor-markdown": [
            "unified",
            "remark-parse",
            "remark-stringify",
            "remark-gfm",
            "remark-math",
            "remark-frontmatter",
            "mdast-util-from-markdown",
            "mdast-util-gfm",
            "mdast-util-to-markdown",
          ],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
