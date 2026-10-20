// §394 spec 0073 D11 · D14 · plan 0126 P7 · P13 — where a click in a sandboxed panel goes. The panel's
// view judges clicks with `handleRenderedClicks`, as a code block does — real user input only, the
// button rules, `data-note` before `data-action` before `href` — and these are the destinations:
//  - `<a href>` opens outside the app, as in a code block;
//  - `data-note` is read against the context ACTIVE at the click (P7): a panel belongs to no note, so it
//    has no block context, and the active context is the one the file tree shows;
//  - `data-action` crosses to the plugin under prompt rights until its handlers settle (D11 ③ — the
//    second entrance, `runPluginAction`), through the delivery its session sets
//    (`setPanelActions`). Before that, and after the unload, a click does nothing and grants nothing.

import { openUrl } from "@tauri-apps/plugin-opener";

import type { RenderedSidebarPanel } from "../plugin-ui-store";
import type { RenderedClickHandlers } from "./rendered-clicks";

import { useContextStore } from "../../stores/context/context";
import { logger } from "../../utils/logger";
import { runPluginAction } from "../plugin-action";
import { openPluginNoteLink } from "./note-link";
import { panelActionDelivery } from "./panel-contents";

/**
 * A real click on `data-action` in panel `key` (D11 ③). The plugin's handlers for that panel run under
 * prompt rights until they settle. No timeout here: the session's `invokeAction` ends at its
 * `CALL_TIMEOUT_MS`, which stops while a prompt is open. Does nothing — and grants nothing — when the
 * plugin has no delivery, or when `key` is not under its `${pluginId}:` prefix. Never rejects
 * (`runPluginAction` logs a failure).
 */
export function dispatchPanelAction(
  pluginId: string,
  key: string,
  action: string,
): Promise<void> {
  const deliver = panelActionDelivery(pluginId);
  const prefix = `${pluginId}:`;
  if (deliver === undefined || !key.startsWith(prefix)) {
    return Promise.resolve();
  }
  const id = key.slice(prefix.length);
  return runPluginAction(pluginId, () => deliver(id, action), null);
}

/**
 * The destinations of a judged click in `panel` (`handleRenderedClicks`). `source` gives the panel's
 * `Plugin · {name}` at the click — the badge of a refused note link's toast.
 */
export function panelClickHandlers(
  panel: Pick<RenderedSidebarPanel, "panelId" | "pluginId">,
  source: () => string,
): RenderedClickHandlers {
  return {
    action: (name) => {
      void dispatchPanelAction(panel.pluginId, panel.panelId, name);
    },
    link: (href) => {
      openUrl(href).catch((err: unknown) => {
        logger.error("[PluginPanel] opening a link failed:", err);
      });
    },
    note: (path) => {
      void openPluginNoteLink(
        useContextStore.getState().activeContextId,
        path,
        source(),
      );
    },
  };
}
