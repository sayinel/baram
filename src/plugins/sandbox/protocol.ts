// §260 Sandbox message protocol — the typed host↔sandbox contract. Payloads
// cross a WebviewWindow boundary as Tauri event payloads (serde-JSON — see the
// serialization guard in the client; NOT arbitrary structured clone).
//
// ‼️ Per-member notes live INSIDE the member's braces. `perfectionist` sorts union
// members alphabetically on every lint run, and a comment written above a member
// stays behind while the member moves — silently reattaching the note to whatever
// sorts into that slot. (This already happened once in `plugin-op.ts`, and again
// here when the 3c-2c frames were added.)
import type { AICompleteOptions } from "../types";

/** Main app → sandbox realm. */
export type HostToSandbox =
  | {
      // §260 3c-2b — no URL here: the sandbox pulls its own bundle through the
      // broker (`source_read`, resolved in Rust from the caller's window label) and
      // imports it from a blob URL, so the realm needs no `asset:` and holds no
      // file-read power.
      pluginId: string;
      type: "activate";
    }
  | {
      // §260 3c-2c — a streamed token for `ai_stream`, relayed by the host. The
      // sandbox holds no `core:event:*` permission, so it cannot hear `llm:token`
      // itself — which is the point: the host decides what of the LLM exchange the
      // plugin sees.
      requestId: string;
      token: string;
      type: "hostStreamToken";
    }
  | {
      // §260 3c-2c — the failed answer to a `hostRequest`.
      error: string;
      ok: false;
      requestId: string;
      type: "hostResponse";
    }
  | {
      // §260 3c-2c — the successful answer to a `hostRequest`.
      ok: true;
      requestId: string;
      type: "hostResponse";
      value: unknown;
    }
  | {
      args: unknown[];
      callId: string;
      commandId: string;
      type: "invokeCommand";
    }
  | { args: unknown[]; event: string; type: "deliverEvent" }
  | { type: "deactivate" };

/**
 * §260 3c-2c — what a sandbox may ask the HOST realm to do, as opposed to the Rust
 * broker (`PluginOp`). `ai` lives here because its policy is frontend state:
 * privacy mode, and which model/provider/baseUrl a task uses. Note what these
 * requests CANNOT say — there is no model, provider, or URL field, so a plugin can
 * neither pick an endpoint nor step around privacy mode. Prompt in, tokens out.
 */
export type SandboxHostRequest =
  | {
      // §260 Phase 4a — set the text of one DECLARED status-bar item. `id` is the
      // manifest-declared id, not a store key: the host namespaces it and refuses one
      // this plugin did not declare, so the frame cannot reach another plugin's item.
      id: string;
      kind: "ui_status_bar";
      text: string;
    }
  | {
      // §260 Phase 4a — show a toast. Host-mediated for the same reason `ai` is: the
      // decision is main-realm policy. The host supplies the ATTRIBUTION (the plugin's
      // name), so this frame cannot ask to speak as the app, and the rate limit lives
      // there too — the app's toast slot is single, so an unbounded plugin could hold
      // it against the app's own messages.
      kind: "ui_notify";
      message: string;
      type?: "error" | "info" | "warning";
    }
  | { kind: "ai_complete"; opts?: AICompleteOptions; prompt: string }
  | { kind: "ai_list_models" }
  | { kind: "ai_stream"; opts?: AICompleteOptions; prompt: string };

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
  | {
      // §260 3c-2c — a host-mediated service call. `requestId` is the sandbox's own
      // correlation id; the host echoes it back and never treats it as an identity
      // (the caller's identity is the Tauri window label, stamped in Rust).
      request: SandboxHostRequest;
      requestId: string;
      type: "hostRequest";
    }
  | { args: unknown[]; event: string; type: "emitEvent" }
  | { callId: string; error: string; ok: false; type: "callResult" }
  | { callId: string; ok: true; type: "callResult"; value: unknown }
  | { error: string; type: "activateError" }
  | { registered: SandboxRegisteredReport; type: "ready" };
