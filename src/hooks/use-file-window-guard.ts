// §89 A file window answers for itself when it is closed, and tells the main window what it holds
// for the exits that end both (`services/file-windows.ts`).
//
// ‼️ The close comes here rather than through `app://close-requested`, because that one is answered
// by the main window's quit flow: with nothing unsaved there, closing this window quit the app.
// `close_action` in `src-tauri/src/lib.rs` lets a `file-*` close through, and tauri holds it for as
// long as the `onCloseRequested` listener below exists.
import { useEffect, useRef } from "react";

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  onReportRequest,
  reportSaveResult,
  reportUnsaved,
  SAVE_REQUEST,
} from "../services/file-windows";
import { isTabUnsaved, useEditorStore } from "../stores/editor/editor";
import { useUIStore } from "../stores/ui/ui";
import { awaitBlockIdRenames } from "../utils/editor/block-id-rename-landing";

/**
 * @param tabId the window's one tab, `null` until the file has loaded
 * @param unsaved whether that tab holds unsaved work
 * @param handleSave writes the tab's text and lowers its marks on success
 */
export function useFileWindowGuard(
  tabId: null | string,
  unsaved: boolean,
  handleSave: () => Promise<void>,
): void {
  const latest = useRef({ handleSave, tabId, unsaved });
  latest.current = { handleSave, tabId, unsaved };

  useEffect(() => {
    void reportUnsaved(unsaved);
  }, [unsaved]);

  useEffect(() => {
    const stillUnsaved = () => {
      const { sourceEditedTabs, tabs } = useEditorStore.getState();
      return isTabUnsaved(
        tabs.find((t) => t.id === latest.current.tabId),
        sourceEditedTabs,
      );
    };
    const listening = Promise.all([
      onReportRequest(() => void reportUnsaved(latest.current.unsaved)),
      getCurrentWebviewWindow().listen(SAVE_REQUEST, () => {
        void latest.current
          .handleSave()
          .then(() => reportSaveResult(!stillUnsaved()));
      }),
      getCurrentWindow().onCloseRequested(async (event) => {
        // issue 594: same barrier as the main window's exits.
        await awaitBlockIdRenames();
        const { tabId: id } = latest.current;
        if (id !== null && stillUnsaved()) {
          event.preventDefault();
          useUIStore
            .getState()
            .openUnsavedModal({ intent: "closeWindow", tabId: id });
        }
      }),
    ]);
    return () => {
      listening
        .then((unlisteners) => {
          for (const unlisten of unlisteners) unlisten();
        })
        .catch(() => {});
    };
  }, []);
}
