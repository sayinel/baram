// §392 spec 0071 §6.2–§6.4 — the editable plugin viewer mounts the host can take text from.
//
// A LEAF on purpose: no value imports. The editor store imports this module (the D15 gate in
// `markDirty`, `flushViewerEdits`), so an import of a store from here would close a cycle.
// `PluginViewerHost` registers an entry per editing mount; `getSourceBuffer`
// (`use-source-mode.ts`, through `hooks/viewer-edit-pull.ts`) takes from it.

/** One editing mount: a viewer element showing one tab's text. */
export interface ViewerEditMount {
  /**
   * The host's `onUpdate` for this mount, with `ctx.edit.text` set to `text` (spec §6.4).
   * Assigned by the host after the object exists, because it closes over the mount's own
   * `markChanged`.
   */
  deliver: (text: string) => void;
  readonly el: HTMLElement;
  readonly filePath: string;
  readonly getText: (el: HTMLElement) => string;
  /**
   * "A change the host has not taken yet" — set by `markChanged` (spec §6.2 step 1), cleared
   * by a take (§6.3) or a host write (§6.4).
   */
  pending: boolean;
  readonly pluginId: string;
  readonly tabId: string;
  readonly viewerId: string;
}

/** What a take found (spec §6.3 · §7.4). */
export type ViewerTextPull =
  | { error: unknown; kind: "failed"; viewerId: string }
  | { kind: "none" }
  | { kind: "text"; text: string };

/**
 * By tab id. One entry per tab, because at most one viewer host is up at a time: the two
 * `<PluginViewerHost` render sites outside tests are both in `EditorArea.tsx` (which `App.tsx`
 * renders once), in two exclusive branches that draw the active tab (`surfaceKind === "image"`,
 * and `"preview"` with a plugin viewer), and §290 keeps a plugin-drawn tab out of the retained
 * pool (`retainedKindForTab` in `use-retained-tabs.ts`). React runs an old mount's cleanup
 * (which unregisters it) before the next mount's effect.
 */
const mounts = new Map<string, ViewerEditMount>();

/**
 * Spec §6.4 — another writer put `text` in the tab's buffer: the host's text replaces the
 * viewer's untaken change, and the viewer is sent it. The caller compares with the buffer's
 * previous value first (`setSourceBuffer`).
 */
export function deliverHostWrite(tabId: string, text: string): void {
  const mount = mounts.get(tabId);
  if (!mount) return;
  mount.pending = false;
  mount.deliver(text);
}

/** Spec D15 — does `tabId`'s viewer hold a change no read has taken? `markDirty(false)` asks. */
export function hasPendingViewerEdit(tabId: string): boolean {
  return mounts.get(tabId)?.pending === true;
}

/** The tabs whose viewer holds an untaken change and that `match` selects (spec §6.6 · §7.3). */
export function pendingViewerEditTabIds(
  match: (mount: ViewerEditMount) => boolean,
): string[] {
  return [...mounts.values()]
    .filter((mount) => mount.pending && match(mount))
    .map((mount) => mount.tabId);
}

/** The host's, when an editing mount comes up. */
export function registerViewerEditMount(mount: ViewerEditMount): void {
  mounts.set(mount.tabId, mount);
}

/**
 * Spec §6.3 · §7.4 — take the tab's untaken change: `getText` runs only when there is one,
 * and the mark is cleared whatever it returns. A failed take left marked would keep the tab
 * dirty for good — D15 refuses to lower it.
 */
export function takePendingViewerText(tabId: string): ViewerTextPull {
  const mount = mounts.get(tabId);
  if (!mount?.pending) return { kind: "none" };
  mount.pending = false;
  try {
    const text: unknown = mount.getText(mount.el);
    if (typeof text === "string") return { kind: "text", text };
    return {
      error: new TypeError(`getText returned ${typeof text}, not a string`),
      kind: "failed",
      viewerId: mount.viewerId,
    };
  } catch (error) {
    return { error, kind: "failed", viewerId: mount.viewerId };
  }
}

/** Removes `mount` only while it is still the tab's entry, so a late cleanup cannot drop a newer mount. */
export function unregisterViewerEditMount(mount: ViewerEditMount): void {
  if (mounts.get(mount.tabId) === mount) mounts.delete(mount.tabId);
}
