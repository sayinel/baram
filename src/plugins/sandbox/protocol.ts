// §260 Sandbox message protocol — the typed host↔sandbox contract. Payloads
// cross a WebviewWindow boundary as Tauri event payloads (serde-JSON — see the
// serialization guard in the client; NOT arbitrary structured clone).

/** Main app → sandbox realm. */
export type HostToSandbox =
  | {
      args: unknown[];
      callId: string;
      commandId: string;
      type: "invokeCommand";
    }
  | { args: unknown[]; event: string; type: "deliverEvent" }
  | { pluginId: string; pluginUrl: string; type: "activate" }
  | { type: "deactivate" };

/**
 * What the plugin actually BOUND during activate. The manifest's Phase-1
 * `PluginContributions` remains the authoritative static surface (titles,
 * palette, menu, statusBar) that the install UI consented to; the host
 * validates this report against it (warns on divergence).
 */
export interface SandboxRegisteredReport {
  commands: string[];
  events: string[];
}

/** Sandbox realm → main app. */
export type SandboxToHost =
  | { args: unknown[]; event: string; type: "emitEvent" }
  | { callId: string; error: string; ok: false; type: "callResult" }
  | { callId: string; ok: true; type: "callResult"; value: unknown }
  | { error: string; type: "activateError" }
  | { registered: SandboxRegisteredReport; type: "ready" };
