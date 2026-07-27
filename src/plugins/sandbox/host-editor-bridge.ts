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
 * §260 Phase 4b security review (MEDIUM-1/2) — a budget denominated in BYTES, per plugin.
 *
 * The document ops are the first requests whose main-realm cost tracks the DOCUMENT rather
 * than the request: a ~90-byte `editor_get_markdown` frame buys a whole
 * `prosemirrorToMarkdown` walk plus an IPC copy of the result, and the sandbox realm owns
 * its own JS, so it can drive the transport command in a loop rather than going through
 * `ctx.editor`. Nothing upstream bounds that usefully — the frame validator cannot cap what
 * is not in the frame, the in-flight slot recycles as soon as staging returns, and
 * `RateClass::Transport` admits 150/s, which is 5–15× more whole-document work than the
 * thread can perform. The result would be an indefinite editor freeze bought with
 * `editor:readonly`, the grant a user reads as harmless.
 *
 * So the meter charges what the work costs. A per-CALL limit cannot do this — the same call
 * is free on a scratch note and expensive on a 10,000-line one — while a byte budget lets a
 * small document be polled freely and throttles a large one in proportion. The refill is
 * set well under the thread's serialization throughput (§8.4 puts a save, which includes
 * `prosemirrorToMarkdown`, under 100 ms for a document of a few hundred KiB), so a
 * saturating plugin costs a fraction of a frame rather than all of it.
 *
 * NOT memoised on document identity as well: the IPC copy into `plugin_sandbox_stage` is
 * O(document) too, so caching the serialization would not change the worst case this
 * bucket already bounds — it would only add a second retained copy of the user's document.
 */
export const DOCUMENT_BUDGET_BURST_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_BUDGET_REFILL_BYTES_PER_SECOND = 512 * 1024;

/**
 * What one `insertText` transaction is charged even when its text is short.
 *
 * 32 KiB works out to ~16 inserts/second sustained and 128 back to back — well above
 * typing speed and well below the rate at which whole-document re-renders make the app
 * unresponsive. A plugin that wants to install a large block should use `setMarkdown`,
 * which is charged and capped for exactly that.
 */
const INSERT_TRANSACTION_COST_BYTES = 32 * 1024;

export interface EditorRequestHandlerOptions {
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
    capabilities,
    editor = getEditorInstance,
    now = () => Date.now(),
    pluginId,
    stage = pluginSandboxStage,
    surfaceBlocked = editorSurfaceBlocked,
  } = options;
  const budget = createDocumentBudget(now);
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
        // Small by nature (a selection is what a user highlighted), so it answers inline
        // and is not metered. `readSelection` is shared with the trusted tier so the
        // position/offset rule cannot diverge between them.
        return readSelection(live("getSelection"));
      }
      case "editor_insert_text": {
        requireCapability(EDITOR_WRITE_CAPABILITIES, "insertText");
        const instance = live("insertText");
        const { from, to } = instance.state.selection;
        // Charged its own length, with a FLOOR (§260 Phase 4b code review, I2 follow-on):
        // not the document's size, because that would make incremental writing — the main
        // use of the `editor` grant — unusable, but not zero either, because a transaction
        // on a large document costs in proportion to the mounted NodeView count, so 150
        // tiny inserts per second is the same freeze by another route. The floor prices the
        // TRANSACTION; the length prices the payload.
        //
        // Honest residual: the floor is a flat estimate, so on a very large document the
        // real per-transaction cost is still under-priced relative to a read. Pricing it
        // properly would need the document's size, which is the thing that breaks
        // streaming.
        budget.spend(
          Math.max(request.text.length, INSERT_TRANSACTION_COST_BYTES),
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
        budget.spend(request.markdown.length, "setMarkdown");
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
        const next = await markdownToProsemirrorAsync(
          request.markdown,
          instance.schema,
        );
        // Re-resolved after the await, because awaiting yields to the app: the user may
        // have switched tabs (handing over a keep-alive editor with its OWN Schema),
        // toggled source mode, or closed the file. Dispatching into the old instance would
        // write to a detached document; dispatching nodes built against the old schema
        // into a new one is the cross-schema validation failure above.
        const target = live("setMarkdown");
        if (target.schema !== instance.schema) {
          throw new Error(
            "editor.setMarkdown: the editor changed while the document was parsing",
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
 * A token bucket in bytes — the same shape as Rust's `PluginRateLimiter`, and for the same
 * reason: a burst lets ordinary use through in one go, while a runaway loop settles to the
 * refill rate instead of pinning the main thread.
 */
function createDocumentBudget(now: () => number) {
  let tokens = DOCUMENT_BUDGET_BURST_BYTES;
  let updated = now();
  return {
    spend(bytes: number, method: string): void {
      const at = now();
      // `max(0, …)`: a clock that goes backwards must neither mint tokens nor, by rewinding
      // `updated`, hand the NEXT call a larger elapsed to mint from.
      const elapsed = Math.max(0, at - updated) / 1000;
      tokens = Math.min(
        DOCUMENT_BUDGET_BURST_BYTES,
        tokens + elapsed * DOCUMENT_BUDGET_REFILL_BYTES_PER_SECOND,
      );
      if (at > updated) updated = at;
      if (tokens < bytes) {
        throw new Error(
          `editor.${method}: this plugin's document budget is exhausted ` +
            `(${DOCUMENT_BUDGET_REFILL_BYTES_PER_SECOND} bytes/second, burst ` +
            `${DOCUMENT_BUDGET_BURST_BYTES}); read or write the document less often.`,
        );
      }
      tokens -= bytes;
    },
  };
}
