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
      // §4.8 — the document's PROSE: block text with real separators, code and frontmatter
      // excluded, wikilink labels included. Staged like the markdown for the same reason —
      // prose is only a little smaller than its source, so it clears tauri's 8 KiB
      // channel-data threshold on any real document too.
      //
      // WHY a second reader rather than letting plugins strip markdown themselves: the
      // reference Word Count plugin did exactly that arithmetic on `getMarkdown()` and
      // counted `#`, `-` and `|` as words, disagreeing with the app's own status bar in the
      // same status bar. The counting policy is the app's, so the app has to be able to
      // hand it over.
      kind: "editor_get_text";
    }
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
  | {
      // §260 Phase 4b — plain text at the cursor, one undoable step.
      kind: "editor_insert_text";
      text: string;
    }
  | {
      // §260 Phase 4b — replace the whole document, one undoable step. Travels INBOUND
      // (sandbox→host), which needs no staging: that direction is a `plugin_sandbox_report`
      // capped at 8 MiB, and a sandbox holds no event permission to eavesdrop on it.
      kind: "editor_set_markdown";
      markdown: string;
    }
  | {
      // §260 Phase 4b — the document as markdown. The answer does NOT ride this response:
      // a document routinely exceeds tauri's 8 KiB channel-data threshold, past which a
      // frame enters the app-global queue that `FETCH_CHANNEL_DATA_COMMAND` exposes to
      // every webview. The host stages it in Rust and the sandbox pulls it with
      // `PluginOp::StagedRead`, which arrives as an invoke result instead.
      kind: "editor_get_markdown";
    }
  | {
      // §260 Phase 4b — the selection's POSITIONS answer inline; its text is staged, like
      // the document's. It was assumed "small by nature" until Cmd+A, and this comment
      // still said so after the code stopped agreeing (fixed in 4c) — a stale comment is
      // how the next reader re-derives the bug.
      kind: "editor_get_selection";
    }
  | {
      // §260 Phase 4c — every DECLARED settings field and its current value. Staged like a
      // document rather than answered inline: `MAX_SETTING_FIELDS` × `MAX_SETTING_VALUE_CHARS`
      // is already over tauri's 8 KiB channel-data threshold, and a cap chosen to stay under
      // it would put a behaviour change exactly on that boundary.
      kind: "settings_read";
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

/**
 * §260 Phase 4a security review (MEDIUM-1) — a string bounded before any work touches it.
 *
 * `ui_*` are the first frame types whose payload gets O(n) MAIN-REALM processing (two
 * regex passes in `host-ui-bridge`, then a Zustand commit). Rust caps a frame at 8 MiB
 * and allows 150/s, so without a length check here a plugin could aim ~1 GB/s of regex at
 * the thread this tier exists to protect. The host truncates to 200 (toast) / 64 (status
 * bar) anyway, so anything past this bound cannot be a real message — it is dropped like
 * any other malformed frame.
 */
export const MAX_UI_TEXT_CHARS = 4096;

/**
 * §385 — the most bytes one sandbox→host report may carry: Rust's `MAX_SANDBOX_REPORT_BYTES`
 * (`src-tauri/src/commands/plugin_cmd.rs`). Rust drops a larger report WITHOUT answering it,
 * so the prompt pre-check (spec 0061 §9) measures against this before sending.
 * `report-cap-parity.test.ts` reads the Rust declaration and pins the two together.
 */
export const MAX_SANDBOX_REPORT_BYTES = 8 * 1024 * 1024;

/**
 * §385 — the prompt limits (spec 0061 §7). ONE home: the gate (both tiers), the sandbox's
 * pre-check and the host validator all read these, and the sandbox realm already imports this
 * module. A second copy is a limit that drifts.
 */
export const PROMPT_LIMITS = {
  /** An item `id` — a comparison key, so over-long is refused, never cut. */
  idChars: 100,
  /** Items in one quick pick. */
  items: 5_000,
  /** Shown characters of a `label` or `description`; longer is cut with "…". */
  labelChars: 200,
  /** Rows drawn at once, as the Quick Switcher does. */
  rows: 50,
  /** Any one string before it is cut — the bound on what sanitising costs. */
  stringChars: MAX_UI_TEXT_CHARS,
  /** Shown characters of a `title` or `placeholder`. */
  titleChars: 100,
  /** An input box's initial `value`, and what the user may type. */
  valueChars: 1_000,
} as const;
