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
      // §260 multi-page build — sandbox.html is the isolated plugin realm's
      // entry point (src/sandbox/sandbox-entry.ts). "main" must stay listed so
      // index.html still emits at the dist root (Tauri frontendDist needs it).
      input: {
        main: path.resolve(__dirname, "index.html"),
        sandbox: path.resolve(__dirname, "sandbox.html"),
      },
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
      //
      // 4. `**/*.md` — vault를 이 저장소로 쓰면 앱에서 md를 저장하는 것만으로
      //    dev 세션(열린 탭 전부)이 리셋되던 원인 2계열의 원천 차단이다
      //    (2026-08-26 vite:hmr 디버그 계측 + 설치본 소스 추적으로 확정):
      //    (a) docs/*.md는 Help 패널에 `?raw`로 번들되는 실제 모듈이라
      //        저장이 곧 전체 리로드이고,
      //    (b) Tailwind v4의 자동 콘텐츠 감지가 스캔 파일 전부를 감시
      //        의존성으로 등록해두고, 파일 이벤트만 오면 내용 비교 없이
      //        (무수정 Cmd+S 포함) full-reload를 **로그 없이** 직접 쏜다.
      //    base.css의 `source("../")`가 (b)의 표면을 src/로 줄이지만 src/
      //    안의 md(AGENTS.md 등)는 여전히 노출되고, (a)는 별개다 — 이벤트를
      //    워처 단계에서 끊는 것만이 두 계열 모두에 airtight하다. 대가는
      //    dev에서 md 변경이 Help 번들/Tailwind에 반영되지 않는 것뿐이고
      //    (클래스는 전부 src/ 코드에 있음), 프로덕션 빌드는 워처와 무관.
      //    `.md.tmp.*`는 앱의 원자적 저장(tmp+rename)이 만드는 임시 파일.
      ignored: ["**/src-tauri/**", "**/*.md", "**/*.md.tmp.*"],
    },
  },
}));
