// §392 spec 0071 §6.3 · §7.4 — taking an editable viewer's pending change into the source
// buffer, and what happens when the viewer cannot hand it over. `getSourceBuffer`
// (`use-source-mode.ts`) calls this before every read, so every `getSourceBuffer(` caller —
// each reader of a tab's text, spec §2 — sees the taken text.
import { type Locale, t } from "../i18n";
import { takePendingViewerText } from "../plugins/viewer-edit-mounts";
import { useEditorStore } from "../stores/editor/editor";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";

/**
 * Take `tabId`'s pending viewer change into `buffers` — the map only: no `bufferVersion` bump
 * (no render) and no `onUpdate` back to the viewer the text came from (spec §6.3).
 *
 * A failed take (§7.4) leaves the buffer's last text where it is — the read that called this
 * goes on with it — switches the tab to source view, so the viewer that failed is unmounted,
 * and tells the user once. Every read that can find a pending change runs outside render
 * (D16), so the store writes here are never a render-phase update. A tab that is already
 * closed is neither switched nor announced (§7.2).
 */
export function pullViewerEdit(
  buffers: Map<string, string>,
  tabId: string,
): void {
  const pulled = takePendingViewerText(tabId);
  if (pulled.kind === "none") return;
  if (pulled.kind === "text") {
    buffers.set(tabId, pulled.text);
    return;
  }
  logger.error(
    `[viewer-edit] ${pulled.viewerId} could not hand over the text of tab ${tabId}; switching it to source`,
    pulled.error,
  );
  const { setPreviewSourceForTab, tabs } = useEditorStore.getState();
  if (!tabs.some((tab) => tab.id === tabId)) return;
  setPreviewSourceForTab(tabId, true);
  useUIStore
    .getState()
    .showToast(
      t("viewer.edit.pullFailed", useSettingsStore.getState().locale as Locale),
      "error",
    );
}
