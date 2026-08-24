// §298 Vim Phase 1 — WYSIWYG probe spike gate.
//
// Same idiom as the Phase 0a IME probe: the probe replaces the whole app UI,
// so it must never be reachable in a shipped build. Read at call time (not
// module load) so tests can toggle it with `vi.stubEnv`. The DEV check makes
// production impossibility a code guarantee rather than a convention.
//
//   VITE_VIM_PROBE=1 npm run tauri dev   # authoritative (WKWebView)
//   VITE_VIM_PROBE=1 npm run dev         # quick look (Safari, NOT authoritative)
export function isVimWysiwygProbeEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_VIM_PROBE === "1";
}
