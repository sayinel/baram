// §298 Vim Phase 0a — IME probe spike gate.
//
// The probe is a measurement harness for Korean-IME × WKWebView behavior. It
// replaces the whole app UI when enabled, so it must never be reachable in a
// shipped build. Same idiom as `plugins-enabled.ts` (§259): read at call time
// (not module load) so tests can toggle it via `vi.stubEnv`.
//
//   VITE_IME_PROBE=1 npm run tauri dev   # authoritative (WKWebView)
//   VITE_IME_PROBE=1 npm run dev         # quick first look (Safari, NOT authoritative)
//
// The DEV check makes production impossibility a code guarantee rather than a
// convention: even if someone sets VITE_IME_PROBE=1 in a production build
// environment, the probe stays inert (Codex plan-review hardening).
export function isImeProbeEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_IME_PROBE === "1";
}
