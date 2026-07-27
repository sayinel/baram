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
import { markdownToProsemirrorAsync } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  editorSurfaceBlocked,
  getEditorInstance,
  type PluginEditorHandle,
  readSelection,
} from "../extension-context";
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
 * `MAX_PLUGIN_FILE_BYTES` is what bounds memory). Writes are charged their character count.
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
 * (`dev/impl-notes/large-file-perf-c4-handoff.md`) measured `view.dispatch` forcing a
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
 * ‼️ Streaming, stated because the natural composition hits it: `ctx.ai.stream` +
 * `insertText` per token runs at 20-80/s, which this admits on a small note and refuses on
 * a large document. That is deliberate — per-token insertion is already wrong there, since
 * ProseMirror groups undo by TRANSACTION, so a thousand tokens would be a thousand Cmd+Z
 * presses. Buffer and insert in batches. `SandboxEditorAPI.insertText` says so too.
 */
const WRITE_TRANSACTION_FLOOR = 8 * 1024;

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
  const requireCapability = createCapabilityGate(
    pluginId,
    capabilities,
    "editor",
  );

  /** The live editor, or a refusal the plugin can act on. */
  const live = (method: string): PluginEditorHandle => {
    // Surface FIRST: an editor instance stays mounted in source mode and on a
    // non-markdown tab, but it does not hold the tab's content there, so answering from it
    // would return a stale document and accept a write that the next save discards
    // (security review LOW-3). Distinguishable from "no editor is open" for the same
    // reason that one is distinguishable from an empty document.
    const blocked = surfaceBlocked();
    if (blocked) throw new Error(`editor.${method}: ${blocked}`);
    const instance = editor();
    if (!instance) {
      // An error, not an empty document: a plugin that cannot tell "no editor" from "empty
      // file" would happily overwrite the latter with the former's assumptions.
      throw new Error(`editor.${method}: no editor is open`);
    }
    return instance;
  };

  return async (request: EditorRequest) => {
    switch (request.kind) {
      case "editor_get_markdown": {
        requireCapability(EDITOR_READ_CAPABILITIES, "getMarkdown");
        const instance = live("getMarkdown");
        // Charged BEFORE the walk, from the O(1) content size — metering after the fact
        // would count the cost this exists to refuse. `content.size` is the document's own
        // measure and tracks the serialized length closely enough to price it.
        budget.spend(instance.state.doc.content.size, "getMarkdown");
        const markdown = prosemirrorToMarkdown(instance.state.doc);
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
        // ‼️ SIBLING, out of this phase's scope: `ai_complete` also answers inline and an
        // LLM completion routinely exceeds 8 KiB. Lower severity — it is the plugin's own
        // output, not the user's document — but it is the same queue.
        budget.spend(to - from, "getSelection");
        // `readSelection` is shared with the trusted tier so the position/offset rule
        // cannot diverge between them.
        const selection = readSelection(instance);
        await stage(pluginId, selection.text);
        return { from: selection.from, to: selection.to };
      }
      case "editor_insert_text": {
        requireCapability(EDITOR_WRITE_CAPABILITIES, "insertText");
        const instance = live("insertText");
        const { from, to } = instance.state.selection;
        budget.spend(
          writeCost(request.text.length, instance, limits),
          "insertText",
        );
        // ONE transaction: ProseMirror's history groups by transaction, so this is a
        // single Cmd+Z for the user. `insertText` over the selection range is what makes
        // it behave like typing — replacing a selection rather than appending beside it.
        instance.view.dispatch(
          instance.state.tr.insertText(request.text, from, to),
        );
        return undefined;
      }
      case "editor_set_markdown": {
        requireCapability(EDITOR_WRITE_CAPABILITIES, "setMarkdown");
        const instance = live("setMarkdown");
        budget.spend(
          writeCost(request.markdown.length, instance, limits),
          "setMarkdown",
        );
        // The ASYNC pipeline, which parses in the app's own Web Worker (security review
        // MEDIUM-2): the synchronous form put an attacker-sized remark parse on the thread
        // this tier exists to protect.
        //
        // Node construction and the replace still run HERE, in one transaction —
        // deliberately not the progressive/windowed path the app uses to open a large file
        // (`mdastBlocksToPmNodes` + `appendChunksProgressively`). That path exists because
        // construction dominates the ~38 s load floor, so a large `setMarkdown` pays it
        // (code review P4). It is not adopted because progressive fill has its own
        // hazards — a mid-fill tab switch blessing a truncated document as the save
        // baseline — which are the app's to own for a user action, not something to
        // inherit for a plugin write. The frame validator's 2 MiB cap and the budget
        // above are what bound it instead.
        //
        // Parsed with the LIVE schema, not a fresh one: a node built against a different
        // Schema instance fails ProseMirror's identity-based validation on insert (the
        // keep-alive lesson from the large-file work).
        // ‼️ Captured BEFORE the await, into a local. `handle.state` is a live getter (it
        // reads `view.state`), so comparing `instance.state.doc` afterwards would compare
        // the new document with ITSELF and the guard below could never fire. The first
        // version of that guard did exactly this; the tab-switch test is what caught it.
        const parsedFrom = instance.state.doc;
        const next = await markdownToProsemirrorAsync(
          request.markdown,
          instance.schema,
        );
        // ‼️ The DOCUMENT must still be the one we parsed against, by identity.
        //
        // §260 Phase 4b security review, NEW HIGH — an earlier version compared schemas,
        // which catches only a keep-alive handover. The ordinary tab switch installs a
        // different document into the SAME editor with the SAME schema
        // (`editor.view.updateState(cachedState)`, `use-tab-switching.ts`), so the schema
        // check passed and this replaced ANOTHER FILE's document with content parsed for
        // this one — then marked it dirty, so autosave could write it to disk. No hostile
        // plugin required; an ordinary `setMarkdown` racing a tab switch was enough. The
        // synchronous version could not do this: making the parse async introduced it.
        //
        // Identity, not a change signal, because a signal can be missed: there are at
        // least five paths that install a document via `updateState`, and two of them
        // (external file reload and the §72 properties refresh, `use-editor-effects.ts`)
        // do not call `markContentLoaded`. Comparing the node we hold is the only form
        // that cannot be outrun by a path nobody enumerated.
        //
        // The cost is that a user keystroke during the parse also refuses. That is the
        // right trade for a WHOLE-DOCUMENT replace: the plugin gets an error it can retry,
        // where the alternative is discarding an edit the user just made — the same
        // silent-loss class as LOW-3. Identity also subsumes the schema case, since nodes
        // built against different Schema instances are never the same object.
        const target = live("setMarkdown");
        if (target.state.doc !== parsedFrom) {
          throw new Error(
            "editor.setMarkdown: the document changed while this one was parsing — retry",
          );
        }
        target.view.dispatch(
          target.state.tr.replaceWith(
            0,
            target.state.doc.content.size,
            next.content,
          ),
        );
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
 * rate instead of pinning the main thread.
 */
function createMeter(
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
        throw new Error(
          `editor.${method}: this plugin's ${what} is exhausted; slow down and retry.`,
        );
      }
      tokens -= charge;
    },
  };
}

/** What one write transaction costs: its payload, or the document it re-renders. */
function writeCost(
  payloadLength: number,
  editor: PluginEditorHandle,
  limits: { burst: number; writeFloor?: number },
): number {
  // Capped by the burst as well, so a write can never be priced above what the bucket can
  // ever hold — the Q4 rule, restated at the charge rather than only at the meter.
  const floor = Math.min(
    limits.writeFloor ?? WRITE_TRANSACTION_FLOOR,
    limits.burst,
  );
  return Math.max(payloadLength, editor.state.doc.content.size, floor);
}
