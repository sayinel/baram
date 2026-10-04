// §260 Phase 4b — the host side of `editor` for sandboxed plugins.
//
// WHY the host: the document lives in the main realm as a ProseMirror state. There is
// nothing for Rust to broker — it has no document — so this is mediated like `ai` and
// `ui`, and the capability check here is enforcing because a `plugin-*` window can reach
// neither the store nor the DOM.
//
// WHY markdown both ways: it is the app's round-trippable form, and the pipeline that
// produces it (`prosemirrorToMarkdown` / `markdownToProsemirror`) is the same one the
// editor itself uses to load and save. A plugin therefore reads exactly what it can write
// back — round-trip preservation is the project's first quality criterion, and an `editor`
// API that broke it would be a way to corrupt documents through a "safe" tier.
import type { PluginCapability } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { pluginSandboxStage } from "../../ipc/plugin-invoke";
import { serializeEditorState } from "../../utils/editor/serialize-live-doc";
import { documentProseText } from "../../utils/word-count";
import {
  insertMarkdownAt,
  insertTextAt,
  liveEditor,
  readSelectionForPlugin,
  replaceDocument,
} from "../editor-ops";
import { refuse } from "../editor-refusal";
import {
  editorSurfaceBlocked,
  getEditorInstance,
  type PluginEditorHandle,
} from "../plugin-host-registry";
import { EDITOR_READ_CAPABILITIES, EDITOR_WRITE_CAPABILITIES } from "../types";
import { createCapabilityGate } from "./capability-gate";

/**
 * §260 Phase 4b security review (MEDIUM-1/2) — a budget denominated in WORK, per plugin.
 *
 * The document ops are the first requests whose main-realm cost tracks the DOCUMENT rather
 * than the request: a ~90-byte `editor_get_markdown` frame buys a whole
 * `prosemirrorToMarkdown` walk plus an IPC copy of the result, and the sandbox realm owns
 * its own JS, so it can drive the transport command in a loop rather than going through
 * `ctx.editor`. Nothing upstream bounds that usefully — the frame validator cannot cap what
 * is not in the frame, the in-flight slot recycles as soon as staging returns, and
 * `RateClass::Transport` admits 150/s, which is far more whole-document work than the
 * thread can perform. The result would be an indefinite editor freeze bought with
 * `editor:readonly`, the grant a user reads as harmless.
 *
 * So the meter charges what the work costs. A per-CALL limit cannot do this — the same call
 * is free on a scratch note and expensive on a 10,000-line one — while this lets a small
 * document be polled freely and throttles a large one in proportion.
 *
 * The unit is a CPU proxy, NOT bytes, and the names say so. Reads are charged
 * `doc.content.size` (ProseMirror positions — the right denominator for a walk, but ~3x
 * under UTF-8 for Korean text, so it must not be read as a memory bound; Rust's 8 MiB
 * `MAX_PLUGIN_FILE_BYTES` is what bounds memory). Writes are charged the DOCUMENT they
 * re-render, floored, and only additionally their payload where that is larger — see
 * `WRITE_TRANSACTION_FLOOR`. (An earlier version of this line said "their character
 * count", which stopped being true when the charge became document-proportional and left
 * this summary contradicting the rule stated below it.)
 *
 * Derivation, stated as such: §8.4 budgets a save — which includes `prosemirrorToMarkdown`
 * — under 100 ms for a ~500 KB, 10,000-line file, i.e. roughly 6-10 MB/s. The refill is
 * ~5-8% of that. Derived from the project's TARGET, not measured; a benchmark on a 10k-line
 * fixture would turn it from plausible into known. The burst is deliberately ~0.4-0.7 s of
 * contiguous serialization: a sub-second hitch is accepted so bursty use is not throttled.
 *
 * NOT memoised on document identity as well. The bucket bounds the worst case whether or
 * not a cache exists, so a memo would buy PERFORMANCE, not safety — and it would retain a
 * second copy of the user's document. (An earlier version of this note claimed the IPC copy
 * is as expensive as the serialization, which is wrong: `prosemirrorToMarkdown` builds an
 * mdast tree and runs remark-stringify with escaping, far costlier per byte than a copy.
 * The decision stands; the reasoning written here did not.)
 */
export const DOCUMENT_BUDGET_BURST = 4 * 1024 * 1024;
export const DOCUMENT_BUDGET_REFILL_PER_SECOND = 512 * 1024;

/**
 * The floor on what one write transaction costs, for a document small enough that its own
 * size would price it at almost nothing.
 *
 * §260 Phase 4b review — a write's cost is NOT in its payload. The C4 handoff notes
 * (`dev/impl-notes/0033-large-file-perf-c4-handoff.md`) measured `view.dispatch` forcing a
 * synchronous layout of the whole contenteditable for selection sync: ~53 ms on a huge
 * document versus ~4 ms on a small one, i.e. linear in RENDERED BLOCK COUNT. So a 4 KiB
 * `insertText` at the transport's 150/s is seconds of layout per second of wall clock — a
 * hard freeze from a tiny frame, invisible to any payload-based charge.
 *
 * Charging the DOCUMENT's size expresses that measurement directly, and is why this is a
 * floor rather than a flat rate. A flat rate was the first attempt and was wrong in both
 * directions at once: it overcharged a 1 KB note 32x what READING that note costs, while
 * still under-pricing a 500 KB one. Scaling with the document gives ~64 writes/s on a
 * scratch note and ~1/s on a large file — throttling where the freeze actually is.
 *
 * ‼️ Those rates are for ONE transaction, i.e. `insertText`. A successful `setMarkdown`
 * spends payload AND transaction separately (see the M1 split there), so at 500 KB it
 * costs ~1 MB — about 0.5/s, not the ~1/s a reader would carry over from this line.
 * `insertMarkdown` (§388) splits the same way; its payload is capped at 64 KiB by the frame
 * check, so the transaction term dominates on a large document.
 *
 * ‼️ Streaming, stated because the natural composition hits it: `ctx.ai.stream` +
 * `insertText` per token runs at 20-80/s, which this admits on a small note and refuses on
 * a large document. That is deliberate — per-token insertion is already wrong there, since
 * each insert is its own undo step (§388 spec 0067 §5), so a thousand tokens would be a
 * thousand Cmd+Z presses. Buffer and insert in batches.
 */
export const WRITE_TRANSACTION_FLOOR = 8 * 1024;

export interface EditorRequestHandlerOptions {
  /**
   * Test seam, like `now`: the production values are MiB-scale, so exercising the meter
   * against them would need MiB-scale fixtures — which cost seconds each under the full
   * suite and made one test time out. Behaviour is pinned here with small numbers; the
   * production values are a tuning decision, documented with their derivation above.
   */
  budget?: { burst: number; refillPerSecond: number; writeFloor?: number };
  /** Grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  /** Injectable for tests; defaults to the live editor. */
  editor?: () => null | PluginEditorHandle;
  /** Injectable for tests; defaults to the wall clock. */
  now?: () => number;
  pluginId: string;
  /** Injectable for tests; defaults to the host-only staging command. */
  stage?: (pluginId: string, payload: string) => Promise<void>;
  /** Injectable for tests; defaults to the app's live surface state. */
  surfaceBlocked?: () => null | string;
}

type EditorRequest = Extract<SandboxHostRequest, { kind: `editor_${string}` }>;

export function createEditorRequestHandler(
  options: EditorRequestHandlerOptions,
): (request: EditorRequest) => Promise<unknown> {
  const {
    budget: limits = {
      burst: DOCUMENT_BUDGET_BURST,
      refillPerSecond: DOCUMENT_BUDGET_REFILL_PER_SECOND,
    },
    capabilities,
    editor = getEditorInstance,
    now = () => Date.now(),
    pluginId,
    stage = pluginSandboxStage,
    surfaceBlocked = editorSurfaceBlocked,
  } = options;
  const budget = createMeter(
    now,
    limits.burst,
    limits.refillPerSecond,
    "document budget",
  );
  const gate = createCapabilityGate(pluginId, capabilities, "editor");
  /**
   * The shared capability gate, its refusal coded `not-permitted` and worded like every
   * other editor refusal (spec 0067 §9 · §10). The gate's sentence is kept whole as the
   * reason: it names the grant to declare, and plugins and fixtures match on it.
   */
  const requireCapability = (
    accepted: readonly PluginCapability[],
    method: string,
  ): void => {
    try {
      gate(accepted, method);
    } catch (err) {
      refuse("not-permitted", method, (err as Error).message);
    }
  };

  /**
   * The live editor, or a coded refusal — `liveEditor`, the gate both tiers share, fed this
   * tier's injected `surfaceBlocked` and `editor`. Surface FIRST: an editor instance stays
   * mounted in source mode and on a non-markdown tab, but it does not hold the tab's content
   * there, so answering from it would return a stale document and accept a write that the
   * next save discards (security review LOW-3).
   */
  const live = (method: string): PluginEditorHandle =>
    liveEditor(method, surfaceBlocked, editor);
  const ops = { live, owner: pluginId };

  return async (request: EditorRequest) => {
    switch (request.kind) {
      case "editor_get_markdown": {
        requireCapability(EDITOR_READ_CAPABILITIES, "getMarkdown");
        const instance = live("getMarkdown");
        // Charged BEFORE the walk, from the O(1) content size — metering after the fact
        // would count the cost this exists to refuse. `content.size` is the document's own
        // measure and tracks the serialized length closely enough to price it.
        budget.spend(instance.state.doc.content.size, "getMarkdown");
        const markdown = serializeEditorState(instance.state);
        // Staged, never returned inline (see `plugin/staging.rs`). AWAITED before this
        // handler resolves, because resolving is what sends the response frame that tells
        // the sandbox to pull — answering first would race the sandbox to an empty slot.
        await stage(pluginId, markdown);
        return undefined;
      }
      case "editor_get_selection": {
        requireCapability(EDITOR_READ_CAPABILITIES, "getSelection");
        const instance = live("getSelection");
        const { from, to } = instance.state.selection;
        // ‼️ NOT "small by nature" (§260 Phase 4b code review, I1). One keystroke — Cmd+A —
        // makes this a whole-document read, and the previous version was both UNMETERED
        // and answered INLINE. Inline is the part that mattered: the response frame goes
        // out over `SandboxChannels::send`, which has no cap (only a dev warning), so a
        // frame at or above 8 KiB enters tauri's app-global channel-data queue — ACL-exempt,
        // guessable sequential id, readable by another sandboxed plugin. That is exactly
        // the disclosure this phase was built to prevent, reached through the read that was
        // assumed too small to matter.
        //
        // So it is charged like a read (O(1) to compute, before the walk) and its text
        // travels the SAME staged path as `getMarkdown` rather than in the frame. Always
        // staged, not only when large: one path has no threshold to get wrong, and the
        // extra round trip is invisible next to a user-driven call.
        //
        // The SIBLING this note used to defer — `ai_complete` answering inline, which let a
        // plugin holding `editor:readonly` + `ai` route document-derived text into the same
        // queue — was closed in 4c by streaming it (`host-ai-bridge`). Kept as a pointer
        // rather than deleted: the composition it describes is the reason both calls are
        // shaped the way they are.
        budget.spend(to - from, "getSelection");
        // The read and the ref through the core the trusted tier uses, so neither the
        // position/offset rule nor what a ref records can diverge between the tiers. Only a
        // plugin that can write gets a ref that names something (spec 0067 §7.1).
        const selection = readSelectionForPlugin(ops, "getSelection", {
          record: EDITOR_WRITE_CAPABILITIES.some((c) =>
            capabilities.includes(c),
          ),
        });
        // A bare caret is the common case and its text is `""`. Staging that would buy a
        // Rust slot write and a broker pull to deliver nothing, and would occupy the ONE
        // shared slot, serialising an empty read against an in-flight `getMarkdown` (code
        // review N1). Not a size judgement — empty or not is exact — so it keeps the
        // "no threshold to get wrong" property. The ref rides inline either way: 32 hex
        // digits, nowhere near the 8 KiB threshold (spec 0067 §8).
        if (from === to) return { from, ref: selection.ref, staged: false, to };
        await stage(pluginId, selection.text);
        return {
          from: selection.from,
          ref: selection.ref,
          staged: true,
          to: selection.to,
        };
      }
      case "editor_get_text": {
        requireCapability(EDITOR_READ_CAPABILITIES, "getText");
        const instance = live("getText");
        // Charged the same as `getMarkdown`, from the same O(1) measure: this is also a
        // whole-document walk, and metering it after the fact would count the cost the
        // budget exists to refuse.
        budget.spend(instance.state.doc.content.size, "getText");
        // The app's OWN counting policy — the same function the status bar reads — so a
        // plugin cannot arrive at a different number for the same document.
        const text = documentProseText(instance.state.doc);
        await stage(pluginId, text);
        return undefined;
      }
      case "editor_insert_markdown": {
        requireCapability(EDITOR_WRITE_CAPABILITIES, "insertMarkdown");
        // SPLIT like `setMarkdown` (spec 0067 §8): the payload before the parse, because the
        // worker parse really happens; the transaction only once every check has passed, so a
        // write refused after the parse — a tab switch, a changed range — burns no
        // document-sized charge. The core calls `beforeParse` after its surface gate and ref
        // check, and `beforeDispatch` right before it sends.
        await insertMarkdownAt(ops, {
          beforeDispatch: () =>
            budget.spend(
              transactionCost(live("insertMarkdown"), limits),
              "insertMarkdown",
            ),
          beforeParse: () =>
            budget.spend(request.markdown.length, "insertMarkdown"),
          markdown: request.markdown,
          ref: request.replace,
        });
        return undefined;
      }
      case "editor_insert_text": {
        requireCapability(EDITOR_WRITE_CAPABILITIES, "insertText");
        // Charged right before the send, after the core's checks: there is no parse, so the
        // one charge is `insertCost` — the payload or the document it re-renders.
        insertTextAt(ops, {
          beforeDispatch: () =>
            budget.spend(
              insertCost(request.text.length, live("insertText"), limits),
              "insertText",
            ),
          ref: request.replace,
          text: request.text,
        });
        return undefined;
      }
      case "editor_set_markdown": {
        requireCapability(EDITOR_WRITE_CAPABILITIES, "setMarkdown");
        // The parse, the identity guard and the replace live in `replaceDocument`
        // (`editor-ops.ts`), with their §260 Phase 4b notes.
        //
        // SPLIT along the two costs (§260 Phase 4b code review, M1). The payload is
        // charged before the parse, because the worker parse and the transfer really happen;
        // the TRANSACTION after the identity guard, because a lost race dispatches nothing.
        // Charging both up front meant a user keystroke during the parse — which the guard
        // refuses by design, and which is likeliest on the large documents where the parse
        // is slowest — burned a full document-sized charge per attempt, so a plugin obeying
        // the error's "retry" advice exhausted its burst and was then told "document budget
        // is exhausted": a diagnostic pointing away from the cause.
        //
        // ‼️ The SUM is intended, and it is a real increase: this used to charge
        // `max(payload, transaction)`, so replacing a 500 KB document with 500 KB of
        // markdown went from ~500K to ~1M. Both costs are genuinely incurred on the
        // success path, and the direction is conservative — the trade is that a lost race
        // got much cheaper while a completed write got somewhat dearer.
        //
        // RESIDUAL, accepted (re-review Q1): the transaction charge can refuse after the
        // guard has passed, so a budget-exhausted plugin can force a worker parse plus the
        // transfer back per attempt and get nothing. Bounded — the validator's 2 MiB cap
        // means two attempts on a full burst, then one per ~4 s — and the parse is off the
        // main thread. The alternative, peeking then spending, puts a TOCTOU on the budget.
        await replaceDocument(ops, {
          beforeDispatch: (target) =>
            budget.spend(transactionCost(target, limits), "setMarkdown"),
          beforeParse: () =>
            budget.spend(request.markdown.length, "setMarkdown"),
          markdown: request.markdown,
        });
        return undefined;
      }
      default: {
        const unknown: never = request;
        throw new Error(
          `unsupported editor request: ${JSON.stringify(unknown)}`,
        );
      }
    }
  };
}

/**
 * A token bucket — the same shape as Rust's `PluginRateLimiter`, and for the same reason:
 * a burst lets ordinary use through in one go, while a runaway loop settles to the refill
 * rate instead of pinning the main thread. Its refusal is coded `budget` (spec 0067 §10).
 */
export function createMeter(
  now: () => number,
  burst: number,
  perSecond: number,
  what: string,
) {
  let tokens = burst;
  let updated = now();
  return {
    spend(cost: number, method: string): void {
      const at = now();
      // `max(0, …)`: a clock that goes backwards must neither mint tokens nor, by rewinding
      // `updated`, hand the NEXT call a larger elapsed to mint from.
      const elapsed = Math.max(0, at - updated) / 1000;
      tokens = Math.min(burst, tokens + elapsed * perSecond);
      if (at > updated) updated = at;
      // ‼️ CLAMPED to the burst (§260 Phase 4b security review, Q4). `tokens` can never
      // exceed `burst`, so an uncapped charge above it would make the call fail FOREVER —
      // a document larger than the burst would be permanently unreadable, while the error
      // told the plugin to try less often, which could not possibly help. Reachable: a user
      // can open a 5 MB note, and Rust stages up to 8 MiB. Clamping costs one full burst
      // for such a document, i.e. one read per refill cycle, which is a throttle rather
      // than a wall.
      const charge = Math.min(cost, burst);
      if (tokens < charge) {
        refuse(
          "budget",
          method,
          `this plugin's ${what} is exhausted; slow down and retry.`,
        );
      }
      tokens -= charge;
    },
  };
}

/**
 * What ONE `insertText` costs: its payload, or the document it re-renders.
 *
 * Named for its single caller (§260 Phase 4b re-review, N2). `setMarkdown` and
 * `insertMarkdown` do not use it — they charge the same two terms separately, at different
 * moments; see the M1 note on `setMarkdown`.
 */
export function insertCost(
  payloadLength: number,
  editor: PluginEditorHandle,
  limits: { burst: number; writeFloor?: number },
): number {
  return Math.max(payloadLength, transactionCost(editor, limits));
}

/**
 * What the DISPATCH costs: the document it re-renders, never less than the floor.
 *
 * ‼️ Unbounded above on purpose — `spend` is what clamps a charge to the burst (the Q4
 * rule), and an earlier comment here wrongly claimed this function did it too. The
 * `Math.min` below applies to the FLOOR alone, so a test-injected budget smaller than the
 * floor is not swamped by it.
 */
function transactionCost(
  editor: PluginEditorHandle,
  limits: { burst: number; writeFloor?: number },
): number {
  const floor = Math.min(
    limits.writeFloor ?? WRITE_TRANSACTION_FLOOR,
    limits.burst,
  );
  return Math.max(editor.state.doc.content.size, floor);
}
