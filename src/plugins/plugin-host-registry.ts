// §69 Plugin Host Registry — tier-neutral singletons and policy primitives.
//
// Everything here is shared by BOTH the trusted and the sandboxed tier: the command
// registry, the event bus, and the live-editor handle are process-wide state that must
// have exactly one definition, or a handler registered by one tier could be invoked
// through the other's registry while the palette (or the app) looks in the wrong place.
// `extension-context.ts` re-exports these names so existing `./extension-context`
// imports keep resolving; new tier-neutral code should import from here directly.
//
// Split out of `extension-context.ts` (§298 review) specifically to fix an import
// direction: the sandboxed tier used to reach these symbols through a file whose own
// header says its capability gate "is NOT a trust boundary" (§259) — a security
// reviewer following `sandbox/host-editor-bridge.ts` landed in a module about the
// TRUSTED tier's lack of isolation. These primitives carry no such caveat; they are
// just shared bookkeeping.
import type { Disposable } from "./types";
import type { Schema } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { useEditorStore } from "../stores/editor/editor";
import { isTabLoading, loadedTabId } from "../utils/editor/programmatic-update";
import { logger } from "../utils/logger";

// --- Command Registry (shared across all plugins, both tiers) ---
export const commandHandlers = new Map<
  string,
  (...args: unknown[]) => unknown
>();

// --- Event Bus (shared across all plugins, both tiers) ---
export type EventHandler = (...args: unknown[]) => void;
export const eventListeners = new Map<string, Set<EventHandler>>();

// --- Editor handle ---
/**
 * What the plugin tiers need from the live editor.
 *
 * §260 Phase 4b widened this from a hand-written structural shape to the real
 * ProseMirror types, because the sandboxed tier's `editor` service serialises the
 * document through the app's own pipeline (`state.doc` → markdown) and writes through a
 * single transaction (`state.tr` → `view.dispatch`). Structural guesses were what let the
 * selection bug below survive: `{ selection: { from, to } }` typechecks fine while saying
 * nothing about what those numbers index into.
 */
export interface PluginEditorHandle {
  chain: () => Record<string, unknown>;
  commands: Record<string, unknown>;
  getHTML: () => string;
  getText: () => string;
  schema: Schema;
  state: EditorState;
  view: { dispatch: (tr: Transaction) => void };
}

let editorInstance: null | PluginEditorHandle = null;

/**
 * Why the Tiptap document is not the tab's authoritative content right now, or `null`.
 *
 * §260 Phase 4b security review (LOW-3) — an editor instance being present does not mean
 * it holds what the user is editing. In Source Mode the user edits CodeMirror while the
 * Tiptap doc keeps its pre-toggle content (`use-source-mode.ts`), and for a source-mode or
 * non-markdown tab `handleSave` writes `sourceContentRef` and ignores the Tiptap doc
 * entirely (`use-file-operations.ts`). A plugin reading through this surface would then
 * get a STALE document, and a write would be silently discarded on the next toggle or
 * save — a read-modify-write losing the user's edits with no error anywhere.
 *
 * A string rather than a boolean so the refusal can say which case it is: a plugin that
 * cannot distinguish "wrong surface" from "no editor" cannot tell the user what to do.
 *
 * ‼️ Initialised BLOCKED, not clear (§260 Phase 4b code review, M4). For a guard whose
 * whole job is preventing silent data loss, "nobody has told me yet" must not read as "all
 * clear" — the same fail-closed rule as `serviceOf`'s unknown prefix and Rust's
 * `is_registered`. The App effect clears it on mount, long before any plugin activates,
 * so this costs nothing in practice; it just stops the guarantee resting on that ordering.
 */
let editorSurfaceBlockedReason: null | string =
  "the editor surface has not been reported yet";

/**
 * The reason given when there is no editor at all — as opposed to an editor holding an empty file.
 *
 * An error rather than an empty document, in BOTH tiers: a plugin that cannot tell the two apart
 * reads `""`, transforms it, writes it back, and has emptied the user's file.
 */
export const NO_EDITOR_OPEN = "no editor is open";

/**
 * How every `editor.*` refusal is worded, in both tiers (#322).
 *
 * One home for the sentence rather than two call sites composing the same template — the reason
 * `legacyEntryMessage` has one too. It is a formatter and not a "should I refuse?" predicate
 * because the sandboxed tier injects its own `surfaceBlocked` and `editor` getters for tests, so
 * only the wording can be shared, not the decision.
 */
export function editorRefusalMessage(method: string, reason: string): string {
  return `editor.${method}: ${reason}`;
}

/**
 * Why the plugin editor surface is unusable right now, or `null` when the Tiptap document
 * really is the tab's content. See `editorSurfaceBlockedReason`.
 */
export function editorSurfaceBlocked(): null | string {
  if (editorSurfaceBlockedReason) return editorSurfaceBlockedReason;
  // Progressive load, checked LIVE rather than through the App effect (§260 Phase 4b
  // security review, Q6): during a large-document tab switch or source-mode toggle the
  // editor holds only the first chunk while `appendChunksProgressively` fills the rest, so
  // a read here returns a TRUNCATED document and a read-modify-write would save the
  // truncation. `loadingTabs` is a plain Set — it changes without a React render, so an
  // effect would observe it late; reading it per request cannot.
  const { activeTabId } = useEditorStore.getState();
  // The fourth instance of this class (§260 Phase 4b re-review, M3), and the same
  // question: is the Tiptap document the tab's content? With no tab there is nothing for
  // it to be the content OF. Reachable — closing the last tab sets `activeTabId` to null
  // — and `setEditor` is never called with null (`App.tsx` falls back to the shared
  // editor), so `live()` would otherwise hand a plugin the document the user just closed
  // as though it were open — for a macrotask while the deferred empty-document install is
  // pending, and then indefinitely, since that branch never calls `markContentLoaded`.
  //
  // ‼️ A §89 single-file window has no tabs at all (`FileEditorLayout` never touches the
  // tab store), so this would block its editor surface permanently. Harmless today because
  // those realms skip `initializePlugins` entirely — but if plugins are ever loaded there,
  // this predicate needs a file-window branch rather than a debugging session.
  if (!activeTabId) return "no document is open";
  if (isTabLoading(activeTabId)) return "the document is still loading";
  // …and the window BEFORE that flag is set (§260 Phase 4b security review, LOW). The
  // store's `activeTabId` flips at the start of a tab switch while installation is still
  // deferred, so for a macrotask (cache hit) or a worker round trip (cache miss) the editor
  // still holds the OUTGOING tab's document — a read would return another file's content
  // and a write would be discarded by the pending `updateState`. Every install path ends at
  // `markContentLoaded`, so this is exactly "has the editor caught up yet?".
  if (loadedTabId() !== activeTabId) {
    return "the editor has not finished switching to this tab";
  }
  return null;
}

/** Emit a plugin event from the host */
export function emitPluginEvent(event: string, ...args: unknown[]): void {
  eventListeners.get(event)?.forEach((handler) => {
    try {
      handler(...args);
    } catch (e) {
      logger.error(`[Plugin Event Error] ${event}:`, e);
    }
  });
}

/** Execute a plugin command from the host */
export async function executePluginCommand(
  id: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = commandHandlers.get(id);
  if (!handler) throw new Error(`Plugin command not found: ${id}`);
  return handler(...args);
}

/**
 * The live editor, or `null` before one is mounted (and in a §89 file-mode window until
 * its editor is ready). Exported for the sandboxed tier's host bridge, which needs the
 * document and the schema rather than the trusted tier's convenience methods.
 */
export function getEditorInstance(): null | PluginEditorHandle {
  return editorInstance;
}

/**
 * The selected text, and the ProseMirror positions it came from.
 *
 * ‼️ `from`/`to` are ProseMirror DOCUMENT positions — they count node boundaries — so they
 * cannot index a flat string. This used to be `getText().slice(from, to)`, which silently
 * returns the wrong text for any document with more than one block: the offsets diverge by
 * one per block boundary crossed. `doc.textBetween` is the app's own idiom for this
 * (`utils/ai-commands.ts`), though the `"\n"` separator is an IMPROVEMENT on that call
 * site rather than a copy of it — `ai-commands` passes none, so a multi-block selection
 * comes back as one run-on line. Stated because this changes the trusted tier's
 * observable output too (§260 Phase 4b code review, N4).
 *
 * Shared by both tiers (§260 Phase 4b) so the fix cannot land in one and not the other.
 */
export function readSelection(editor: PluginEditorHandle): {
  from: number;
  text: string;
  to: number;
} {
  const { from, to } = editor.state.selection;
  return { from, text: editor.state.doc.textBetween(from, to, "\n"), to };
}

/**
 * §260 3c-1 — register a host-side command handler by its full id
 * (`${pluginId}.${commandId}`). Sandboxed plugins have no main-realm
 * ExtensionContext; their command bodies run in the sandbox webview, so the
 * loader registers a thin handler here that forwards to `session.invokeCommand`.
 * Reuses the same registry the CommandPalette executes through.
 */
export function registerHostCommandHandler(
  fullId: string,
  handler: (...args: unknown[]) => unknown,
): Disposable {
  commandHandlers.set(fullId, handler);
  return { dispose: () => void commandHandlers.delete(fullId) };
}

export function setEditorInstance(editor: unknown): void {
  editorInstance = editor as null | PluginEditorHandle;
}

/**
 * Record why the Tiptap document is not the active tab's content, or `null` to clear it.
 * Called by the app whenever the surface changes; see `editorSurfaceBlockedReason`.
 */
export function setEditorSurfaceBlocked(reason: null | string): void {
  editorSurfaceBlockedReason = reason;
}
