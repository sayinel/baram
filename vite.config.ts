import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // §8.4 Build optimization — group large vendor families into stable chunks.
  // rolldown codeSplitting groups replace the Vite 8-deprecated
  // rollupOptions.manualChunks function; first matching group wins.
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-tauri",
              test: /[\\/]node_modules[\\/]@tauri-apps[\\/]/,
            },
            {
              name: "vendor-react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/,
            },
            {
              name: "vendor-editor",
              test: /[\\/]node_modules[\\/](@tiptap[\\/]|prosemirror-|orderedmap[\\/])/,
            },
            {
              name: "vendor-codemirror",
              test: /[\\/]node_modules[\\/](@codemirror[\\/](autocomplete|commands|language|search|state|view)|@lezer[\\/]highlight)[\\/]/,
            },
            {
              name: "vendor-katex",
              test: /[\\/]node_modules[\\/]katex[\\/]/,
            },
            {
              name: "vendor-markdown",
              test: /[\\/]node_modules[\\/](unified[\\/]|remark-|mdast-util-|micromark|unist-util-|vfile[\\/])/,
            },
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
