// §69 Plugin file-viewer host — mounts a plugin-registered viewer into the
// editor area. The host owns the React lifecycle; the plugin owns the DOM
// inside the element it is handed. Plugin callbacks are fenced with
// try/catch so a broken viewer degrades to an empty pane instead of
// unwinding the app through the root error boundary.
//
// §392 spec 0071 — an EDITING mount (§5: an `editable` viewer, a file `isViewerEditableFile`
// accepts, and the tab's source buffer filled) also gets `ctx.edit`. Its text is the source
// buffer's, read in an effect and never in render (D16), and the mount is registered in
// `plugins/viewer-edit-mounts.ts` so that every reader of the buffer takes the viewer's change
// first.

import { memo, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import type { PluginFileViewer } from "../../plugins/plugin-ui-store";
import type { PluginFileViewerContext } from "../../plugins/types";
import type { ViewerEditMount } from "../../plugins/viewer-edit-mounts";

import {
  registerViewerEditMount,
  unregisterViewerEditMount,
} from "../../plugins/viewer-edit-mounts";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { isViewerEditableFile } from "../../utils/file-type";
import { logger } from "../../utils/logger";

/**
 * §392 What an editing mount needs from the source-buffer side: `useSourceMode`'s read and
 * readiness check, and `useCodeAutoSave`'s re-arm. App passes them down through `EditorArea`.
 */
export interface ViewerEditHostDeps {
  /** The read that takes a pending viewer change first (spec 0071 §6.3). */
  getSourceBuffer: (tabId: string) => string;
  /**
   * Spec §5 condition 4. Its identity changes on every buffer write (it follows `bufferVersion`
   * in `use-source-mode.ts`); the write that fills this tab's buffer is what re-renders this
   * host so it can mount.
   */
  hasSourceBuffer: (tabId: string) => boolean;
  /** Spec §6.2 step 3. */
  rearmAutoSave: (tabId: string) => void;
}

/** The refs both mount kinds read, bundled for the two functions below. */
interface MountRefs {
  ctxRef: RefObject<PluginFileViewerContext>;
  deliveredCtxRef: RefObject<null | PluginFileViewerContext>;
  editMountRef: RefObject<null | ViewerEditMount>;
  editRef: RefObject<ViewerEditHostDeps>;
}

interface PluginViewerHostProps {
  /** §392 The source-buffer side of an editing mount. A draw-only mount never touches it. */
  edit: ViewerEditHostDeps;
  filePath: string;
  /** Bumped on saves / external reloads — flows into ctx for re-fetching. */
  refreshKey: number;
  /** §392 The tab shown — part of an editing mount's identity (§7.1 · D13). */
  tabId: string;
  viewer: PluginFileViewer;
}

export const PluginViewerHost = memo(function PluginViewerHost({
  edit,
  filePath,
  refreshKey,
  tabId,
  viewer,
}: PluginViewerHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The ctx most recently delivered to the plugin — lets the update effect
  // skip the redundant onUpdate that would otherwise fire right after mount.
  const deliveredCtxRef = useRef<null | PluginFileViewerContext>(null);
  // §392 This host's live editing mount, if it has one — the update effect's zoom delivery.
  const editMountRef = useRef<null | ViewerEditMount>(null);
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);

  const ctx: PluginFileViewerContext = useMemo(() => {
    const base = convertFileSrc(filePath);
    return {
      assetUrl: refreshKey ? `${base}?v=${refreshKey}` : base,
      filePath,
      refreshKey,
      zoomLevel,
    };
  }, [filePath, refreshKey, zoomLevel]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const editRef = useRef(edit);
  editRef.current = edit;

  // §392 spec 0071 §5 — conditions 1–3 decide what KIND of mount this is; condition 4 (the tab's
  // buffer is filled) decides WHEN. An editing mount waits for it with nothing mounted, not even
  // a draw-only one. `hasSourceBuffer` only reads whether the map has the key — no take.
  const editable = isEditMount(viewer, filePath);
  const ready = !editable || edit.hasSourceBuffer(tabId);
  // A draw-only mount is (viewer, filePath) as before; an editing mount is also its tab (§7.1).
  const mountTabId = editable ? tabId : null;

  // Mount once per identity (`mountTabId` above); a ctx change goes to the update effect below
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !ready) return;
    const refs: MountRefs = { ctxRef, deliveredCtxRef, editMountRef, editRef };
    return mountTabId === null
      ? mountToDraw(el, viewer, refs)
      : mountToEdit(el, viewer, mountTabId, filePath, refs);
  }, [viewer, filePath, mountTabId, ready]);

  useEffect(() => {
    const el = hostRef.current;
    const delivered = deliveredCtxRef.current;
    if (!el || !delivered || delivered === ctx) return;
    const mount = editMountRef.current;
    if (mount) {
      // §392 §6.5 (D10) — an editing mount hears zoom here and nothing else: its own save moves
      // `refreshKey`, and sending that back would reload the change it just made. The text goes
      // out after a take, so a pending change is in it.
      deliveredCtxRef.current = ctx;
      if (delivered.zoomLevel !== ctx.zoomLevel) {
        mount.deliver(editRef.current.getSourceBuffer(mount.tabId));
      }
      return;
    }
    if (guard(viewer, "onUpdate", () => viewer.onUpdate?.(el, ctx))) {
      deliveredCtxRef.current = ctx;
    }
  }, [viewer, ctx]);

  return <div className="plugin-viewer-host" ref={hostRef} />;
});

/** Runs one plugin callback inside the fence (see the header); true when it returned. */
function guard(
  viewer: PluginFileViewer,
  step: string,
  run: () => void,
): boolean {
  try {
    run();
    return true;
  } catch (err) {
    logger.error(`[PluginViewerHost] ${viewer.viewerId} ${step} failed:`, err);
    return false;
  }
}

/**
 * §392 spec 0071 §5 conditions 1–3. Condition 2 (`files`) was checked when the viewer
 * registered (`trusted/ui-api.ts`), so `editable` already implies it.
 */
function isEditMount(viewer: PluginFileViewer, filePath: string): boolean {
  return (
    viewer.editable === true &&
    typeof viewer.getText === "function" &&
    isViewerEditableFile(filePath)
  );
}

/** The mount every viewer had before §392: no `ctx.edit`; down is onUnmount, then an emptied element. */
function mountToDraw(
  el: HTMLElement,
  viewer: PluginFileViewer,
  { ctxRef, deliveredCtxRef }: MountRefs,
): () => void {
  if (guard(viewer, "onMount", () => viewer.onMount(el, ctxRef.current))) {
    deliveredCtxRef.current = ctxRef.current;
  }
  return () => {
    deliveredCtxRef.current = null;
    guard(viewer, "onUnmount", () => viewer.onUnmount?.(el));
    el.replaceChildren();
  };
}

/**
 * §392 spec 0071 §6.1 · §6.2 · §7.2 — an editing mount: start it from the buffer's text,
 * register it, and on the way down take its change before onUnmount empties the element.
 */
function mountToEdit(
  el: HTMLElement,
  viewer: PluginFileViewer,
  tabId: string,
  filePath: string,
  { ctxRef, deliveredCtxRef, editMountRef, editRef }: MountRefs,
): () => void {
  // D13 — a markChanged that outlives its mount does nothing. The element can be reused for
  // another tab (the host has no `key`), so "is this mount alive" is this flag, not the tab.
  let live = true;
  const mount: ViewerEditMount = {
    deliver: () => {},
    el,
    filePath,
    // `isEditMount` let this mount through only with a function here.
    getText: viewer.getText as (el: HTMLElement) => string,
    pending: false,
    pluginId: viewer.pluginId,
    tabId,
    viewerId: viewer.viewerId,
  };
  // §6.2 — mark, dirty, re-arm. Nothing is serialized: the text is taken when something reads.
  const markChanged = (): void => {
    if (!live) return;
    mount.pending = true;
    // Gated in the store: only the call that changes the flag renders (D8).
    useEditorStore.getState().markDirty(tabId, true);
    editRef.current.rearmAutoSave(tabId);
  };
  const contextWith = (text: string): PluginFileViewerContext => ({
    ...ctxRef.current,
    edit: { markChanged, tabId, text },
  });
  mount.deliver = (text) => {
    guard(viewer, "onUpdate", () => viewer.onUpdate?.(el, contextWith(text)));
  };

  // §6.1 — the text is read here, in the effect, and before this mount is registered: nothing
  // of it is pending yet, so the read takes nothing.
  const text = editRef.current.getSourceBuffer(tabId);
  registerViewerEditMount(mount);
  editMountRef.current = mount;
  if (guard(viewer, "onMount", () => viewer.onMount(el, contextWith(text)))) {
    deliveredCtxRef.current = ctxRef.current;
  }

  return () => {
    // §7.2 — take first, then onUnmount, then empty the element, whatever caused the unmount.
    // A tab that is already closed is not read from: no getText, no switch to source, no toast.
    if (useEditorStore.getState().tabs.some((t) => t.id === tabId)) {
      editRef.current.getSourceBuffer(tabId);
    }
    live = false;
    unregisterViewerEditMount(mount);
    if (editMountRef.current === mount) editMountRef.current = null;
    deliveredCtxRef.current = null;
    guard(viewer, "onUnmount", () => viewer.onUnmount?.(el));
    el.replaceChildren();
  };
}
