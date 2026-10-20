// §394 spec 0073 D11 · D14 · plan 0126 P7 · P13 — where a click in a sandboxed panel goes. The panel's
// view judges clicks with `handleRenderedClicks`, as a code block does — real user input only, the
// button rules, `data-note` before `data-action` before `href` — and these are the destinations:
//  - `<a href>` opens outside the app, as in a code block;
//  - `data-note` is read against the context ACTIVE at the click (P7): a panel belongs to no note, so it
//    has no block context, and the active context is the one the file tree shows;
//  - `data-action` crosses to the plugin under prompt rights until its handlers settle (D11 ③ — the
//    second entrance, `runPluginAction`), through the delivery its session sets
//    (`setPanelActions`). Before that, and after the unload, a click does nothing and grants nothing.
//
// Also here: putting a sandboxed plugin's declared panels up when it loads (`registerDeclaredPanels`,
// P9) — from the manifest, before the sandbox starts, as the loader puts its declared status-bar items
// up.

import { openUrl } from "@tauri-apps/plugin-opener";

import type { RenderedSidebarPanel } from "../plugin-ui-store";
import type { Disposable, PluginManifest } from "../types";
import type { RenderedClickHandlers } from "./rendered-clicks";

import { useContextStore } from "../../stores/context/context";
import { logger } from "../../utils/logger";
import { declaredPanels, MAX_PANEL_ICON_CHARS } from "../manifest-panels";
import { runPluginAction } from "../plugin-action";
import {
  MAX_ENTRY_TITLE_CHARS,
  pluginSourceLabel,
  sanitizePluginText,
} from "../plugin-text";
import { usePluginUIStore } from "../plugin-ui-store";
import { openPluginNoteLink } from "./note-link";
import {
  closePanel,
  openPanel,
  panelActionDelivery,
  panelKey,
} from "./panel-contents";

/**
 * An icon that draws nothing: empty, or default-ignorable code points alone — some of which
 * `sanitizePluginText` keeps and a manifest accepts as one character (measured: ZWJ and ZWNJ, which
 * join emoji and scripts; the variation selector U+FE0F; U+3164 HANGUL FILLER).
 */
const BLANK_ICON = /^\p{Default_Ignorable_Code_Point}*$/u;

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

/**
 * §394 spec 0073 D14 · plan 0126 P9 · P22 — `manifest`'s declared panels, straight from the manifest and
 * before the sandbox starts, as `registerDeclaredStatusBar` puts declared items up: each button shows
 * while the plugin boots, and each panel is open (`openPanel`) before a request can name it. The list
 * is `declaredPanels`' — the one the loader also hands the session as the ids `ui_set_panel` may name.
 * The title, the icon and the plugin's name are the author's and reach the activity bar with no plugin
 * code running, so they are sanitized here; an icon that then draws nothing (`BLANK_ICON`) is left
 * out, and the activity bar draws its own in its place. Without `sidebar` — a consent that narrowed it
 * away, the one case where `declaredPanels` returns none of a declared list — the panels are skipped
 * with a warning. Each panel's removal goes onto `disposables`, which the unload and the rollback both
 * run.
 */
export function registerDeclaredPanels(
  manifest: PluginManifest,
  disposables: Disposable[],
): void {
  const panels = declaredPanels(manifest);
  if (panels.length === 0) {
    if ((manifest.contributions?.panels ?? []).length > 0) {
      logger.warn(
        `[PluginLoader] ${manifest.id} declares panels without the "sidebar" capability — ignoring them`,
      );
    }
    return;
  }
  const sourceName = pluginSourceLabel(manifest.name, manifest.id);
  for (const panel of panels) {
    const key = panelKey(manifest.id, panel.id);
    const icon =
      panel.icon === undefined
        ? ""
        : sanitizePluginText(panel.icon, MAX_PANEL_ICON_CHARS);
    openPanel(key);
    usePluginUIStore.getState().registerSidebarPanel({
      ...(BLANK_ICON.test(icon) ? {} : { icon }),
      kind: "rendered",
      panelId: key,
      pluginId: manifest.id,
      sourceName,
      title: sanitizePluginText(panel.title, MAX_ENTRY_TITLE_CHARS) || panel.id,
    });
    disposables.push({
      dispose: () => {
        usePluginUIStore.getState().removeSidebarPanel(key);
        closePanel(key);
      },
    });
  }
}
