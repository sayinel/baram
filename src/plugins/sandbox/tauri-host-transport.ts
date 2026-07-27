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
  /**
   * Request ids this transport has forwarded, COUNTED, and not yet seen answered.
   *
   * §260 Phase 4b code review (M3) — `refuseIfAwaited` must not answer an id the SESSION
   * is still working on. The session owns that bookkeeping (`inflightHost`, and it
   * deliberately refuses a replayed id because answering one twice corrupts it), but the
   * refusal happens before the session sees anything, so it cannot consult it. This
   * transport sees both halves — the forwarded request and the outgoing `hostResponse` —
   * so it can answer the question locally: a malformed frame reusing a live id is dropped
   * as before, leaving the real answer to arrive.
   *
   * ‼️ A COUNT, not a set (code review N2). A response does not mean the request it names
   * is finished: a sandbox can send the same id twice, and the session answers the second
   * as a replay while the first is still running — which, with a set, deleted the id and
   * reopened the guard for a third, malformed frame. Counting forwards against responses
   * keeps an id live until as many answers have gone out as requests came in.
   */
  const liveRequests = new Map<string, number>();
  let closed = false;
  const unlisten = await listen<S2HEnvelope>("plugin:s2h", (event) => {
    if (closed) return;
    const envelope = event.payload;
    if (typeof envelope !== "object" || envelope === null) return;
    if (envelope.pluginId !== pluginId) return; // another sandbox's report
    if (!isWellFormed(envelope.msg)) {
      // §260 Phase 4b code review (I2) — a refused REQUEST is answered, not dropped.
      // Dropping is right for protocol noise, but a `hostRequest` is something plugin
      // code is awaiting: with no answer its promise stays pending until the sandbox's
      // own stall timer fires ~150 s later, so an over-cap `setMarkdown` looks to the
      // plugin like the app hung. The correlation id is already in hand and these caps
      // are deliberate refusals rather than corruption, so they can be reported.
      refuseIfAwaited(pluginId, envelope.msg, liveRequests);
      logger.debug(`[Sandbox] dropped malformed s2h frame from ${pluginId}`);
      return;
    }
    if (envelope.msg.type === "hostRequest") {
      const id = envelope.msg.requestId;
      liveRequests.set(id, (liveRequests.get(id) ?? 0) + 1);
    }
    handlers.forEach((h) => h(envelope.msg));
  });
  return {
    close: () => {
      closed = true;
      liveRequests.clear();
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
      // The session answers every id it accepts — on success, on timeout and on dispose —
      // so this is what keeps `liveRequests` from growing for the life of the sandbox.
      if (msg.type === "hostResponse") {
        const outstanding = (liveRequests.get(msg.requestId) ?? 0) - 1;
        if (outstanding > 0) liveRequests.set(msg.requestId, outstanding);
        else liveRequests.delete(msg.requestId);
      }
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
  editor_get_markdown: () => true,
  editor_get_selection: () => true,
  // Its own bound, NOT `isRenderableText` (§260 Phase 4b code review, I2): 4096 is the
  // limit written for one-line toast and status-bar strings, and inserting text silently
  // inherited it. A template, a generated paragraph or a table is ordinarily larger.
  editor_insert_text: (r) =>
    typeof r.text === "string" && r.text.length <= MAX_INSERT_TEXT_CHARS,
  // Not `isRenderableText`: a whole document legitimately exceeds the 4 KiB bound that
  // exists for one-line UI strings. Its own cap instead — see `MAX_SET_MARKDOWN_CHARS`.
  editor_set_markdown: (r) =>
    typeof r.markdown === "string" &&
    r.markdown.length <= MAX_SET_MARKDOWN_CHARS,
  ui_notify: (r) =>
    isRenderableText(r.message) &&
    (r.type === undefined ||
      r.type === "error" ||
      r.type === "info" ||
      r.type === "warning"),
  ui_status_bar: (r) => typeof r.id === "string" && isRenderableText(r.text),
};

// A `Map`, not the record itself, for the lookup: indexing a plain object with an
// attacker-chosen string reaches `Object.prototype` — `type: "constructor"` would
// hand back a function and pass the truthiness test.
const FRAME_LOOKUP = new Map(Object.entries(FRAME_VALIDATORS));
const HOST_REQUEST_LOOKUP = new Map(Object.entries(HOST_REQUEST_VALIDATORS));

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
const MAX_UI_TEXT_CHARS = 4096;

/**
 * §260 Phase 4b security review (MEDIUM-2) — the largest document a plugin may install.
 *
 * `editor_set_markdown` is parsed and then replaces the whole document in one transaction,
 * i.e. a full ProseMirror re-render with NodeView construction, which this project has
 * measured in the tens of seconds for a large document. Deferring to Rust's 8 MiB report
 * cap meant one frame could hang the app for a long time, 150 times a second. Two MiB is
 * roughly seven times the project's own 10,000-line target (§8.4), so it bounds a
 * pathological write without touching a real one, and it is refused HERE — before the
 * parse, the budget and the transaction — like any other malformed frame.
 */
const MAX_SET_MARKDOWN_CHARS = 2 * 1024 * 1024;

/**
 * The largest single text insertion (§260 Phase 4b code review, I2).
 *
 * Sized for what plugins actually insert — a template, a generated paragraph, a table —
 * rather than for a one-line UI string. A plugin installing something larger is replacing
 * the document, which is `setMarkdown`'s job and has its own, larger, cap.
 */
const MAX_INSERT_TEXT_CHARS = 64 * 1024;

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

function isRenderableText(v: unknown): boolean {
  return typeof v === "string" && v.length <= MAX_UI_TEXT_CHARS;
}

function isWellFormed(msg: unknown): msg is SandboxToHost {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Fields;
  const validate =
    typeof m.type === "string" ? FRAME_LOOKUP.get(m.type) : undefined;
  return validate ? validate(m) : false;
}

/**
 * Answer a rejected `hostRequest` so the plugin's promise settles. See the call site.
 *
 * Deliberately vague about WHY: the validator record knows a request failed, not which
 * field failed, and inventing a reason would be worse than saying it was rejected. The
 * caps are documented in the plugin API types, which is where an author looks.
 *
 * Anything that is not a correlatable request is left dropped — there is no one waiting.
 */
function refuseIfAwaited(
  pluginId: string,
  msg: unknown,
  liveRequests: ReadonlyMap<string, number>,
): void {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as Fields;
  if (m.type !== "hostRequest" || typeof m.requestId !== "string") return;
  // Not an id the session is already working on: answering that one early would breach its
  // one-answer-per-id invariant, and its real answer would then be dropped by the client as
  // unknown. Self-inflicted only — ids are per-sandbox — but the invariant is the session's
  // to keep, so this path must not step on it (code review M3).
  if (liveRequests.has(m.requestId)) return;
  void pluginSandboxSend(pluginId, {
    error:
      "the host rejected this request: it is malformed or exceeds a size limit",
    ok: false,
    requestId: m.requestId,
    type: "hostResponse",
  }).catch((err: unknown) => {
    logger.debug(`[Sandbox] refusal to ${pluginId} failed:`, err);
  });
}
