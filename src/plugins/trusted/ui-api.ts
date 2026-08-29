// §69 Plugin UI API (TRUSTED tier only) — the one module in the plugin system that
// touches the DOM: status-bar items, sidebar panels, settings tabs, injected styles,
// and file viewers all go through `document.head` / the plugin UI store from here.
//
// Split out of `extension-context.ts` (§298 review) alongside `plugin-host-registry.ts`
// and `plugin-ai-policy.ts` so the §259 SECURITY LIMITATION comment in
// `extension-context.ts` covers exactly the trusted-tier assembly it is about, rather
// than also shadowing tier-neutral code the sandboxed tier legitimately depends on.
import type {
  Disposable,
  PluginCapability,
  StatusBarItem,
  UIAPI,
} from "../types";

import { useUIStore } from "../../stores/ui/ui";
import { usePluginUIStore } from "../plugin-ui-store";

let uiItemCounter = 0;

export function createUIAPI(
  pluginId: string,
  capabilities: Set<PluginCapability>,
  disposables: Disposable[],
  /**
   * §260 Phase 4a security re-review — the trusted tier attributes its toasts too, or
   * "no badge" would not actually mean "the app is speaking": a trusted plugin's message
   * would read as the app's own. Out of §260's boundary scope (a trusted plugin can call
   * the store directly), but it is what makes the badge a usable signal for the user.
   */
  displayName?: string,
): UIAPI {
  const require = (cap: PluginCapability, method: string) => {
    if (!capabilities.has(cap)) {
      throw new Error(
        `Plugin requires "${cap}" capability to call ui.${method}. ` +
          `Add "${cap}" to the capabilities array in baram-plugin.json.`,
      );
    }
  };
  return {
    showNotification(
      message: string,
      type?: "error" | "info" | "warning",
    ): void {
      useUIStore
        .getState()
        .showToast(message, type, displayName?.trim() || pluginId);
    },
    showStatusBarItem(
      text: string,
      align: "left" | "right" = "right",
    ): StatusBarItem {
      require("statusbar", "showStatusBarItem");
      const itemId = `${pluginId}:sb:${++uiItemCounter}`;
      usePluginUIStore
        .getState()
        .registerStatusBarItem({ align, itemId, pluginId, text });
      const item: StatusBarItem = {
        setText: (t) =>
          usePluginUIStore.getState().updateStatusBarItem(itemId, t),
        dispose: () => usePluginUIStore.getState().removeStatusBarItem(itemId),
      };
      disposables.push({ dispose: item.dispose });
      return item;
    },
    addSidebarPanel(opts) {
      require("sidebar", "addSidebarPanel");
      const panelId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerSidebarPanel({
        icon: opts.icon,
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        panelId,
        pluginId,
        title: opts.title,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeSidebarPanel(panelId),
      };
      disposables.push(disposable);
      return disposable;
    },
    addSettingsTab(opts) {
      require("settings", "addSettingsTab");
      const tabId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerSettingsTab({
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        pluginId,
        tabId,
        title: opts.title,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeSettingsTab(tabId),
      };
      disposables.push(disposable);
      return disposable;
    },
    // Injects into document.head (light DOM); does NOT reach Shadow-DOM panel
    // content — plugins style shadow content from inside onMount(el).
    addStyle(css: string): Disposable {
      const el = document.createElement("style");
      el.setAttribute("data-baram-plugin", pluginId);
      el.textContent = css;
      document.head.appendChild(el);
      const disposable: Disposable = { dispose: () => el.remove() };
      disposables.push(disposable);
      return disposable;
    },
    registerFileViewer(opts) {
      require("viewer", "registerFileViewer");
      const viewerId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerFileViewer({
        // Normalize once at the boundary so matching never re-parses
        extensions: opts.extensions.map((e) =>
          e.replace(/^\./, "").toLowerCase(),
        ),
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        onUpdate: opts.onUpdate,
        pluginId,
        viewerId,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeFileViewer(viewerId),
      };
      disposables.push(disposable);
      return disposable;
    },
  };
}

/** Unregister all UI state (status-bar items + injected styles) for a plugin. */
export function unregisterPluginUI(pluginId: string): void {
  usePluginUIStore.getState().unregisterPlugin(pluginId);
  document.head
    .querySelectorAll(`style[data-baram-plugin="${pluginId}"]`)
    .forEach((n) => n.remove());
}
