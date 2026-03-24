import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;

  if (normalizedId.includes("/@tauri-apps/")) return "vendor-tauri";

  if (
    normalizedId.includes("/react/") ||
    normalizedId.includes("/react-dom/") ||
    normalizedId.includes("/scheduler/") ||
    normalizedId.includes("/zustand/")
  ) {
    return "vendor-react";
  }

  if (
    normalizedId.includes("/@tiptap/") ||
    normalizedId.includes("/prosemirror-") ||
    normalizedId.includes("/orderedmap/")
  ) {
    return "vendor-editor";
  }

  if (
    /\/node_modules\/@codemirror\/(autocomplete|commands|language|search|state|view)\//.test(
      normalizedId,
    ) ||
    normalizedId.includes("/@lezer/highlight/")
  ) {
    return "vendor-codemirror";
  }

  if (normalizedId.includes("/katex/")) return "vendor-katex";

  if (
    normalizedId.includes("/unified/") ||
    normalizedId.includes("/remark-") ||
    normalizedId.includes("/mdast-util-") ||
    normalizedId.includes("/micromark") ||
    normalizedId.includes("/unist-util-") ||
    normalizedId.includes("/vfile/")
  ) {
    return "vendor-markdown";
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // §8.4 Build optimization — group large vendor families into stable chunks.
  build: {
    rollupOptions: {
      output: {
        manualChunks,
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
      // 3. tell Vite to ignore watching non-source directories
      ignored: [
        "**/src-tauri/**",
        "**/.baram/**",
        "**/.git/**",
        "**/node_modules/**",
        "**/tests/**",
        "**/docs/**",
      ],
    },
  },
}));
