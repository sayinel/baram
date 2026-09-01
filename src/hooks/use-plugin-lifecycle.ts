// §69 Plugin system — initializes plugins and the update checkers on mount,
// and keeps the plugin loader's editor instance pointed at the shared editor.
import { useEffect } from "react";

import type { Editor } from "@tiptap/react";

import {
  initializePlugins,
  shutdownPlugins,
} from "../plugins/plugin-lifecycle";
import { pluginLoader } from "../plugins/plugin-loader";
import {
  startUpdateChecker,
  stopUpdateChecker,
} from "../plugins/update-checker";
import {
  startAppUpdateChecker,
  stopAppUpdateChecker,
} from "../services/app-update";
import { FILE_MODE_PATH } from "../utils/file-mode";
import { logger } from "../utils/logger";

export function usePluginLifecycle(editor: Editor | null): void {
  // §69 Plugin system — initialize plugins and update checker on mount
  useEffect(() => {
    // §260 3c-3 — the plugin runtime belongs to ONE host realm. A §89 file-mode
    // window is a second one: this effect runs before the `FILE_MODE_PATH` branch in
    // the render below, so a file window used to load plugins too. Nothing about the
    // design supports that — the Rust authorizer is keyed on `plugin-<id>` with no
    // realm dimension, so both realms fight over the same label, the same grant and
    // (since this phase) the same startup sweep, which would close and revoke the
    // MAIN window's live sandboxes the moment the user opens a file in a new window.
    if (!FILE_MODE_PATH) {
      initializePlugins().catch((err) =>
        logger.error("[App] Plugin initialization failed:", err),
      );
    }
    startUpdateChecker();
    startAppUpdateChecker();
    return () => {
      stopUpdateChecker();
      stopAppUpdateChecker();
      if (!FILE_MODE_PATH) shutdownPlugins().catch((e) => logger.error(e));
    };
  }, []);

  // §69 Plugin system — provide editor instance to plugin loader
  useEffect(() => {
    if (editor) pluginLoader.setEditor(editor);
  }, [editor]);
}
