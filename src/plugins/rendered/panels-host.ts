// §394 spec 0073 D11 · D14 · plan 0126 P7 · P13 — where a click in a sandboxed panel goes. The panel's
// view judges clicks with `handleRenderedClicks`, as a code block does — real user input only, the
// button rules, `data-note` before `data-action` before `href` — and these are the destinations:
//  - `<a href>` opens outside the app, as in a code block;
//  - `data-note` is read against the context ACTIVE at the click (P7): a panel belongs to no note, so it
//    has no block context, and the active context is the one the file tree shows;
//  - `data-action` crosses to the plugin under prompt rights until its handlers settle (D11 ③ — the
//    second entrance, `runPluginAction`), through the delivery the loader sets once the plugin's
//    session is up (`wireSandboxPanels`): the session's `invokeAction`. Before that, and after the
//    unload, a click does nothing and grants nothing.
//
// Also here: putting a sandboxed plugin's declared panels up when it loads (`registerDeclaredPanels`,
// P9) — from the manifest, before the sandbox starts, as the loader puts its declared status-bar items
// up — and wiring their actions to its session once it is up (`wireSandboxPanels`, P13).

import { openUrl } from "@tauri-apps/plugin-opener";

import type { RenderedSidebarPanel } from "../plugin-ui-store";
import type { RenderActionTarget } from "../sandbox/protocol";
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
  setPanelActions,
} from "./panel-contents";

/**
 * An icon that draws nothing: empty, or default-ignorable code points alone. Measured on one-character
 * icons a manifest accepts: `sanitizePluginText` empties " ", "\n", "\t", U+00A0, U+3000, U+202E and
 * U+2060, and keeps U+200D ZWJ and U+200C ZWNJ (which join emoji and scripts), U+FE0F, U+3164 HANGUL
 * FILLER, U+2062 and U+180E — default-ignorable, so blank. Not blank, so kept: a lone U+2800 BRAILLE
 * PATTERN BLANK or combining U+0301 (not default-ignorable), and any icon with a visible code point
 * beside its joiners (a ZWJ family emoji).
 */
const BLANK_ICON = /^\p{Default_Ignorable_Code_Point}*$/u;

/**
 * A real click on `data-action` in panel `key` (D11 ③). The plugin's handlers for that panel run under
 * prompt rights until they settle. No timeout here: the delivery — the session's `invokeAction`
 * (`wireSandboxPanels`) — ends at its `CALL_TIMEOUT_MS`, which stops while a prompt is open. Does
 * nothing — and grants nothing — when the plugin has no delivery, or when `key` is not under its
 * `${pluginId}:` prefix. Never rejects (`runPluginAction` logs a failure).
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
 * is `declaredPanels`' — the one the loader also hands the request handler (`declaredPanelIds`, the ids
 * `ui_set_panel` may name). The sandbox's `activate` gets every id declared in the manifest instead
 * (`panelIds`, plan 0126 P11), granted or not, so a withheld `sidebar` is refused at the host's gate
 * rather than inside the plugin's `activate`.
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

/**
 * §394 plan 0126 P13 — after a sandbox's `activate`: a `data-action` click in one of the plugin's panels
 * becomes an `invokeAction` frame with a `{ kind: "panel" }` target (D13). Until the unload — the
 * removal goes onto `disposables`, and it drops only this delivery, so a later load's survives; the
 * release (`releasePanels`) drops it too.
 */
export function wireSandboxPanels(
  pluginId: string,
  session: {
    invokeAction(target: RenderActionTarget, action: string): Promise<void>;
  },
  disposables: Disposable[],
): void {
  const deliver = (id: string, action: string) =>
    session.invokeAction({ kind: "panel", panelId: id }, action);
  setPanelActions(pluginId, deliver);
  disposables.push({
    dispose: () => {
      if (panelActionDelivery(pluginId) === deliver) {
        setPanelActions(pluginId, null);
      }
    },
  });
}
