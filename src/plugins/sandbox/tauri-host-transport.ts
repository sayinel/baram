import { listen } from "@tauri-apps/api/event";

// §260 Phase 3c-2a — the HOST end of the sandbox transport. Outbound goes over
// the host-only `plugin_sandbox_send` command, which Rust delivers on the target
// sandbox's own IPC channel; inbound is the `plugin:s2h` event Rust re-emits with
// the reporting plugin's id stamped from its window label, so this end filters by
// id rather than trusting a channel name. Thin adapter — the machinery is tested
// against the in-memory pair; this file is covered by its own unit test.
import type {
  HostToSandbox,
  SandboxHostRequest,
  SandboxToHost,
} from "./protocol";
import type { SandboxTransport } from "./transport";

import { pluginSandboxSend } from "../../ipc/plugin-invoke";
import { logger } from "../../utils/logger";

type Fields = Record<string, unknown>;

/** What Rust puts on `plugin:s2h` (see `plugin_sandbox_report`). */
interface S2HEnvelope {
  msg: SandboxToHost;
  pluginId: string;
}

export async function createHostTransport(
  pluginId: string,
): Promise<SandboxTransport<SandboxToHost, HostToSandbox>> {
  const handlers = new Set<(m: SandboxToHost) => void>();
  let closed = false;
  const unlisten = await listen<S2HEnvelope>("plugin:s2h", (event) => {
    if (closed) return;
    const envelope = event.payload;
    if (typeof envelope !== "object" || envelope === null) return;
    if (envelope.pluginId !== pluginId) return; // another sandbox's report
    if (!isWellFormed(envelope.msg)) {
      logger.debug(`[Sandbox] dropped malformed s2h frame from ${pluginId}`);
      return;
    }
    handlers.forEach((h) => h(envelope.msg));
  });
  return {
    close: () => {
      closed = true;
      // `unlisten()` invokes `plugin:event|unlisten`, so it really can reject
      // during window/app teardown — but Tauri types `UnlistenFn` as `() => void`
      // while the implementation returns a promise, so wrap before catching or the
      // rejection is unhandled (and `.catch` does not typecheck).
      void Promise.resolve<unknown>(unlisten()).catch(() => {});
      handlers.clear();
    },
    onMessage: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    // Fire-and-forget: `plugin_sandbox_send` rejects until the sandbox has called
    // `plugin_sandbox_connect`, which is the normal state during the session's
    // activate retry window. Log, never reject into the caller.
    send: (msg) => {
      void pluginSandboxSend(pluginId, msg).catch((err: unknown) => {
        logger.debug(`[Sandbox] send to ${pluginId} failed:`, err);
      });
    },
  };
}

/**
 * §260 3c-2a review (M1) — one validator per frame type. `msg` is fully
 * attacker-controlled: Rust forwards an unvalidated `serde_json::Value`, so the
 * sandbox picks the shape. Each validator must check the discriminant AND every
 * field the corresponding consumer dereferences, or e.g.
 * `{type:"ready",registered:null}` reaches `report.commands` and throws out of the
 * listener. Unknown shapes are dropped, not repaired.
 *
 * ‼️ A RECORD keyed on the discriminant, not a `switch` (§260 3c-2c security review,
 * F1): the switch's `default: return false` silently swallowed the new `hostRequest`
 * frame — `ctx.ai` was dead on the real path for a whole phase while every test
 * passed, because the machinery suites drive the in-memory transport, which has no
 * validator. This form makes TypeScript refuse to compile when a frame type is added
 * without one, so the same omission cannot be made twice.
 */
const FRAME_VALIDATORS: {
  [K in SandboxToHost["type"]]: (m: Fields) => boolean;
} = {
  activateError: (m) => typeof m.error === "string",
  callResult: (m) =>
    typeof m.callId === "string" &&
    (m.ok === true || (m.ok === false && typeof m.error === "string")),
  emitEvent: (m) => typeof m.event === "string" && Array.isArray(m.args),
  hostRequest: (m) =>
    typeof m.requestId === "string" && isHostRequest(m.request),
  ready: (m) => {
    const r = m.registered as Fields | null | undefined;
    return (
      typeof r === "object" &&
      r !== null &&
      Array.isArray(r.commands) &&
      Array.isArray(r.events)
    );
  },
};

/**
 * Same shape, same reason, for the host-mediated request inside a `hostRequest`
 * frame: `host-ai-bridge` dereferences `prompt`, so an `ai_complete` without one
 * would reach `llmComplete` as `undefined`.
 */
const HOST_REQUEST_VALIDATORS: {
  [K in SandboxHostRequest["kind"]]: (r: Fields) => boolean;
} = {
  ai_complete: (r) => typeof r.prompt === "string" && isAiOptions(r.opts),
  ai_list_models: () => true,
  ai_stream: (r) => typeof r.prompt === "string" && isAiOptions(r.opts),
};

// A `Map`, not the record itself, for the lookup: indexing a plain object with an
// attacker-chosen string reaches `Object.prototype` — `type: "constructor"` would
// hand back a function and pass the truthiness test.
const FRAME_LOOKUP = new Map(Object.entries(FRAME_VALIDATORS));
const HOST_REQUEST_LOOKUP = new Map(Object.entries(HOST_REQUEST_VALIDATORS));

/** `AICompleteOptions`, or nothing. Type-checked only — a plugin may legitimately
 *  ask for a large `maxTokens`; that is within its `ai` grant, and the in-flight
 *  bound plus the host's model policy are what constrain cost. */
function isAiOptions(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== "object") return false;
  const o = v as Fields;
  return (
    (o.maxTokens === undefined || typeof o.maxTokens === "number") &&
    (o.systemPrompt === undefined || typeof o.systemPrompt === "string")
  );
}

function isHostRequest(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Fields;
  const validate =
    typeof r.kind === "string" ? HOST_REQUEST_LOOKUP.get(r.kind) : undefined;
  return validate ? validate(r) : false;
}

function isWellFormed(msg: unknown): msg is SandboxToHost {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Fields;
  const validate =
    typeof m.type === "string" ? FRAME_LOOKUP.get(m.type) : undefined;
  return validate ? validate(m) : false;
}
