// §5.5 · §30a issue 594 — which place holds an open tab's document at this
// moment, and how a transaction lands on it. The document may be in a
// source-mode buffer, a view, a pooled keep-alive editor, a cached EditorState,
// or only in the `openFiles` text; the caller decides what to do there, not
// where "there" is.
//
// Authority, in order: a source-mode tab's buffer (its ProseMirror document is
// still alive but stale); the text (`openFiles`) for a tab whose document
// objects are not to be trusted — flagged stale, still loading, or an
// incomplete keep-alive entry; then the document objects themselves.
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import {
  type SourceBufferAccess,
  useEditorStore,
} from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { isTabLoading, loadedTabId } from "./programmatic-update";
import { serializeEditorState } from "./serialize-live-doc";

export type DocumentSurface =
  | { cache: Map<string, EditorState>; kind: "cache"; state: EditorState }
  | { editor: Editor; kind: "keepalive" }
  | { kind: "view"; view: EditorView };

export type OpenTabSurface =
  | DocumentSurface
  | { access: null | SourceBufferAccess; kind: "source" }
  | { kind: "text" };

/**
 * Builds from the surface's current state and lands it. `false` when `build`
 * returned null, and then nothing has been touched. `tab.textKey` is the key of
 * the tab's text in `openFiles`.
 */
export function applyToDocumentSurface(
  surface: DocumentSurface,
  tab: { tabId: string; textKey: string },
  build: (state: EditorState) => null | Transaction,
): boolean {
  switch (surface.kind) {
    case "cache": {
      const tr = build(surface.state);
      if (!tr) return false;
      const next = surface.state.apply(tr);
      surface.cache.set(tab.tabId, next);
      publishBackgroundChange(tab, next);
      return true;
    }
    case "keepalive": {
      const tr = build(surface.editor.state);
      if (!tr) return false;
      surface.editor.view.dispatch(tr);
      // Live, but hidden while its tab is in the background, so nothing else
      // marks it dirty for us.
      publishBackgroundChange(tab, surface.editor.state);
      return true;
    }
    case "view": {
      const { activeTabId, documentSurfaceAccess: access } =
        useEditorStore.getState();
      const { view } = surface;
      const tr = build(view.state);
      if (!tr) return false;
      const keepalive = isKeepaliveView(view);
      if (keepalive || activeTabId === tab.tabId) {
        view.dispatch(tr);
        // A hidden keep-alive editor's update reaches no auto-save.
        if (keepalive && activeTabId !== tab.tabId) {
          publishBackgroundChange(tab, view.state);
        }
        return true;
      }
      // The tab is on its way OUT — the active tab has moved on, the install of
      // the next has not happened. The document is still here, but a dispatched
      // transaction would be attributed by the auto-save to the incoming tab (it
      // reads the active tab at event time) and could write this document to
      // that tab's file. So the state is updated WITHOUT an event:
      // `saveOutgoingTab` then caches and serializes the new state, and the
      // cache entry and text that may already exist are refreshed here as well.
      view.updateState(view.state.apply(tr));
      if (access?.editorStateCache.has(tab.tabId)) {
        access.editorStateCache.set(tab.tabId, view.state);
      }
      publishBackgroundChange(tab, view.state);
      return true;
    }
  }
}

/**
 * The view of the editor that may hold the tab's document, for
 * `locateOpenTabSurface`. Whether it is live is asked of the editor: a destroyed
 * Tiptap editor's `view` is a stub that answers `isDestroyed: false` and throws on
 * `dom`.
 */
export function liveViewOf(tabId: string): EditorView | undefined {
  const access = useEditorStore.getState().documentSurfaceAccess;
  const editor =
    access?.keepaliveEditor(tabId) ??
    (loadedTabId() === tabId ? access?.editor : null);
  return editor && !editor.isDestroyed ? editor.view : undefined;
}

/**
 * Authority order, documented step by step below: source, untrusted → text,
 * view, pool, cache, text. `view` is an editor the caller still has, if any.
 */
export function locateOpenTabSurface(
  tabId: string,
  view: EditorView | undefined,
): OpenTabSurface {
  const editorStore = useEditorStore.getState();
  const { documentSurfaceAccess: access, sourceBufferAccess } = editorStore;

  // 1. A source-mode tab: its buffer is the authoritative text. Its
  //    ProseMirror document is still alive in the shared view — and stale;
  //    a transaction there would be lost when the buffer is parsed back, and
  //    would wake the auto-save for a document that is not the truth.
  if (editorStore.sourceModeTabs.includes(tabId)) {
    return { access: sourceBufferAccess, kind: "source" };
  }

  // 2. Document objects that must not be trusted: a tab flagged stale (its
  //    file changed while it was in the background; the cache is dropped on
  //    return and the text re-parsed), a load still appending blocks, or a
  //    keep-alive entry the load never completed. The text is the authority;
  //    a document object gets the change only once one is installed for real,
  //    so the caller re-checks then.
  const pooled = access?.keepaliveEditor(tabId) ?? null;
  const textOnly =
    editorStore.staleContentTabs.includes(tabId) ||
    isTabLoading(tabId) ||
    (pooled !== null && access !== null && !access.isKeepaliveComplete(tabId));
  if (textOnly) return { kind: "text" };

  // 3. The caller's view (for a rename, the one the edit was made in), if it
  //    still holds this tab's document. A keep-alive view owns its document;
  //    the shared view holds this tab's while the tab is installed in it.
  if (view && viewHoldsTab(view, tabId)) return { kind: "view", view };

  // 4. A large document's keep-alive editor.
  if (pooled && !pooled.isDestroyed) {
    return { editor: pooled, kind: "keepalive" };
  }

  // 5. An ordinary background tab: its document is a cached EditorState (undo
  //    history included), restored when the tab comes back.
  const cached = access?.editorStateCache.get(tabId);
  if (access && cached) {
    return { cache: access.editorStateCache, kind: "cache", state: cached };
  }

  // 6. No document object anywhere — only text, or nothing yet.
  return { kind: "text" };
}

/** The pooled editor's DOM sits under the keep-alive marker (MarkdownSurface). */
function isKeepaliveView(view: EditorView): boolean {
  const dom = (view as { dom?: HTMLElement }).dom;
  return dom?.closest("[data-keepalive-editor]") !== null && dom !== undefined;
}

/**
 * A background tab's `openFiles` snapshot and dirty flag follow its document.
 * The auto-save only watches the active tab (use-auto-save.ts), so a change
 * made to a background document must announce itself: the close/quit guard
 * writes dirty background tabs from `openFiles`.
 */
function publishBackgroundChange(
  tab: { tabId: string; textKey: string },
  state: EditorState,
): void {
  useFileStore
    .getState()
    .setFileContent(tab.textKey, serializeEditorState(state));
  useEditorStore.getState().markDirty(tab.tabId, true);
}

/**
 * Whether `view` still holds the document of `tabId`. The main editing surface
 * is ONE shared view whose document is swapped on every tab switch, plus a
 * pooled keep-alive editor (§perf-large-file C3.5) that keeps its own document
 * while its tab is in the background. A keep-alive view owns its document
 * until it is destroyed; the shared view owns a tab's document while that tab
 * is the one installed in it (`loadedTabId`, which — unlike the active tab id
 * — flips only once the content is actually in).
 *
 * ‼️ §5.5 So `loadedTabId` goes on answering the outgoing tab through a cold load:
 * `load-tab-content.ts` sets the incoming tab's loading flag, then puts the first
 * chunk in the view, and only `finishLoad` announces the install. Reading the view
 * as the outgoing tab's in that window files the incoming document under the
 * outgoing tab, and the next save writes it into that tab's file. While the active
 * tab's flag is on, the outgoing tab falls to its cache or its text instead. A cached
 * restore (`restore-cached-state.ts`) sets no flag, and until its deferred install
 * the view does hold the outgoing document, so that window keeps the answer.
 *
 * Not closed here: a switch that interrupts the load clears the flag
 * (`cancelInflightAppend`), so after leaving for a tab that installs nothing (a graph
 * or plugin tab, a non-markdown file) the view keeps the partial document with no
 * flag on, and this still answers the outgoing tab.
 */
function viewHoldsTab(view: EditorView, tabId: string): boolean {
  if (view.isDestroyed) return false;
  if (isKeepaliveView(view)) return true;
  if (loadedTabId() !== tabId) return false;
  const { activeTabId } = useEditorStore.getState();
  return (
    activeTabId === null || activeTabId === tabId || !isTabLoading(activeTabId)
  );
}
