// §259 Plugin trust-boundary release gate.
//
// Plugins execute in the app's own JavaScript realm with no isolation, so a
// plugin can bypass the ExtensionContext capability checks and call privileged
// Tauri commands directly (secret read, arbitrary network, cross-plugin
// storage). Until the execution model is redesigned to isolate plugins and have
// the backend verify caller identity + capabilities (#260), packaged release
// builds MUST NOT auto-load or install untrusted plugin code.
//
// The gate is OFF by default — including normal dev sessions — and only a build
// that explicitly opts in via `VITE_ENABLE_PLUGINS=1` may load/install plugins
// (used to continue #260 work). Production bundles never set it, so the plugin
// pathways are inert in every shipped artifact.
//
// Read at call time (not module load) so tests can toggle it via `vi.stubEnv`.
export function arePluginsEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_PLUGINS === "1";
}
