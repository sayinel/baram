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
// Production bundles never set it, so the probe is inert in every shipped artifact.
export function isImeProbeEnabled(): boolean {
  return import.meta.env.VITE_IME_PROBE === "1";
}
