// §89 The commands of the native menu that a file window answers itself, while it is the focused
// window. Which commands those are is decided before they get here (`menu_target` in
// `src-tauri/src/lib.rs`).
//
// Some reach it only to be told no. This window is bound to one path and has no Find, no history
// to go back through and no AI panel, and a Reload would throw away what is unsaved. Sent on to the
// main window they would act on a document the user is not looking at.
import { useEffect, useRef } from "react";

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Editor } from "@tiptap/react";

import { type Locale, t } from "../i18n";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import {
  isInsertMenuCommand,
  runInsertMenuCommand,
  sayInsertNeedsTheDocument,
} from "../utils/editor/insert-menu-commands";

export interface FileWindowMenuActions {
  editor: Editor | null;
  /** Writes the window's text. Does nothing until the file has loaded. */
  handleSave: () => Promise<void>;
  /** The document is loaded and on screen, not behind source mode. */
  holdsDocument: boolean;
  /** Switches source mode. Does nothing until the file has loaded. */
  toggleSource: () => void;
}

export function useFileWindowMenu(actions: FileWindowMenuActions): void {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    const listening = getCurrentWebviewWindow().listen<string>(
      "menu-event",
      (event) => {
        const { editor, handleSave, holdsDocument, toggleSource } =
          latest.current;
        const id = event.payload;
        if (id === "file_close_tab") {
          // The same way out as its close button, so it asks about unsaved work.
          void getCurrentWindow().close();
        } else if (id === "file_save") {
          void handleSave();
        } else if (id === "view_source") {
          toggleSource();
        } else if (isInsertMenuCommand(id)) {
          if (holdsDocument) void runInsertMenuCommand(id, editor);
          else sayInsertNeedsTheDocument();
        } else {
          sayUnavailableHere();
        }
      },
    );
    return () => {
      listening.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}

function sayUnavailableHere(): void {
  const locale = useSettingsStore.getState().locale as Locale;
  useUIStore
    .getState()
    .showToast(t("fileEditor.menuUnavailable", locale), "info");
}
