// §69 Plugin UI registry — plugin-registered status-bar items, sidebar
// panels, settings tabs, palette commands, and file viewers (runtime only)
import type { PluginFileViewerContext } from "./types";

import { create } from "zustand";

export interface PluginFileViewer {
  /** Normalized: lowercase, no leading dot. */
  extensions: string[];
  onMount: (el: HTMLElement, ctx: PluginFileViewerContext) => void;
  onUnmount?: (el: HTMLElement) => void;
  onUpdate?: (el: HTMLElement, ctx: PluginFileViewerContext) => void;
  pluginId: string;
  viewerId: string; // namespaced: `${pluginId}:${id}`
}

export interface PluginPaletteCommand {
  commandId: string; // fullId: `${pluginId}.${id}` (matches command registry)
  pluginId: string;
  title: string;
}

export interface PluginSettingsTab {
  onMount: (el: HTMLElement) => void;
  onUnmount?: (el: HTMLElement) => void;
  pluginId: string;
  tabId: string; // namespaced: `${pluginId}:${id}`
  title: string;
}

export interface PluginSidebarPanel {
  icon?: string;
  onMount: (el: HTMLElement) => void;
  onUnmount?: (el: HTMLElement) => void;
  panelId: string; // namespaced: `${pluginId}:${id}`
  pluginId: string;
  title: string;
}

export interface PluginStatusBarItem {
  align: "left" | "right";
  /**
   * §260 Phase 4a — full command id (`${pluginId}.${command}`) to run when the item is
   * clicked, from a sandboxed plugin's `contributions.statusBar[].command`. Absent means
   * the item is display-only, which is every trusted-tier item today.
   */
  command?: string;
  itemId: string;
  /**
   * §260 Phase 4a security re-review (LOW-5) — true between the item's declaration and
   * the moment its command handler exists. Declared items are registered before the
   * sandbox starts (so they show up while it boots), but the handler is only registered
   * once `activate` resolves — up to 15s in dev. Without this the user saw an enabled
   * button that silently did nothing for that whole window.
   */
  pending?: boolean;
  pluginId: string;
  text: string;
  tooltip?: string;
}

interface PluginUIState {
  activePluginPanelId: null | string;
  fileViewers: PluginFileViewer[];
  markPluginCommandsReady: (pluginId: string) => void;
  paletteCommands: PluginPaletteCommand[];
  registerFileViewer: (viewer: PluginFileViewer) => void;
  registerPaletteCommand: (cmd: PluginPaletteCommand) => void;
  registerSettingsTab: (tab: PluginSettingsTab) => void;
  registerSidebarPanel: (panel: PluginSidebarPanel) => void;
  registerStatusBarItem: (item: PluginStatusBarItem) => void;
  removeFileViewer: (viewerId: string) => void;
  removePaletteCommand: (commandId: string) => void;
  removeSettingsTab: (tabId: string) => void;
  removeSidebarPanel: (panelId: string) => void;
  removeStatusBarItem: (itemId: string) => void;
  setActivePluginPanelId: (id: null | string) => void;
  settingsTabs: PluginSettingsTab[];
  sidebarPanels: PluginSidebarPanel[];
  statusBarItems: PluginStatusBarItem[];
  unregisterPlugin: (pluginId: string) => void;
  updateStatusBarItem: (itemId: string, text: string) => void;
}

/**
 * Pure extension match — first registered viewer wins. Kept out of the store
 * so render code (reactive array) and imperative callbacks (getState()) share
 * one matching rule.
 */
export function matchFileViewer(
  viewers: PluginFileViewer[],
  filePath: string | undefined,
): null | PluginFileViewer {
  if (!filePath) return null;
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return viewers.find((v) => v.extensions.includes(ext)) ?? null;
}

export const usePluginUIStore = create<PluginUIState>()((set) => ({
  activePluginPanelId: null,
  fileViewers: [],
  paletteCommands: [],
  settingsTabs: [],
  sidebarPanels: [],
  statusBarItems: [],

  registerFileViewer: (viewer) =>
    set((state) => ({ fileViewers: [...state.fileViewers, viewer] })),

  removeFileViewer: (viewerId) =>
    set((state) => ({
      fileViewers: state.fileViewers.filter((v) => v.viewerId !== viewerId),
    })),

  registerStatusBarItem: (item) =>
    set((state) => ({ statusBarItems: [...state.statusBarItems, item] })),

  // §260 Phase 4a security review (MEDIUM-1) — no-op when the text is unchanged.
  // Without this, every update allocated a fresh array and committed, so a sandboxed
  // plugin calling `setStatusBarText` in a loop re-rendered the status bar at its full
  // frame rate while displaying nothing new.
  updateStatusBarItem: (itemId, text) =>
    set((state) => {
      const current = state.statusBarItems.find((i) => i.itemId === itemId);
      if (!current || current.text === text) return state;
      return {
        statusBarItems: state.statusBarItems.map((i) =>
          i.itemId === itemId ? { ...i, text } : i,
        ),
      };
    }),

  /**
   * The plugin's command handlers are registered: its items are clickable now.
   *
   * Clearing `pending` per PLUGIN rather than per ITEM is only sound because
   * `validateContributions` refuses a `statusBar[].command` that names an undeclared
   * command — so every declared command is guaranteed a handler, and "this plugin's
   * handlers are registered" really does mean "all of its items are clickable". Without
   * that cross-check a one-character typo in a `command` would clear `pending` along with
   * its siblings and leave a permanently enabled, permanently dead button (§260 Phase 4a
   * code review). The two guards hold this invariant up together; do not remove one.
   */
  markPluginCommandsReady: (pluginId) =>
    set((state) => {
      if (
        !state.statusBarItems.some((i) => i.pluginId === pluginId && i.pending)
      ) {
        return state;
      }
      return {
        statusBarItems: state.statusBarItems.map((i) =>
          i.pluginId === pluginId ? { ...i, pending: false } : i,
        ),
      };
    }),

  removeStatusBarItem: (itemId) =>
    set((state) => ({
      statusBarItems: state.statusBarItems.filter((i) => i.itemId !== itemId),
    })),

  registerSidebarPanel: (panel) =>
    set((state) => ({ sidebarPanels: [...state.sidebarPanels, panel] })),

  removeSidebarPanel: (panelId) =>
    set((state) => ({
      sidebarPanels: state.sidebarPanels.filter((p) => p.panelId !== panelId),
    })),

  registerSettingsTab: (tab) =>
    set((state) => ({ settingsTabs: [...state.settingsTabs, tab] })),

  removeSettingsTab: (tabId) =>
    set((state) => ({
      settingsTabs: state.settingsTabs.filter((t) => t.tabId !== tabId),
    })),

  registerPaletteCommand: (cmd) =>
    set((state) => ({ paletteCommands: [...state.paletteCommands, cmd] })),

  removePaletteCommand: (commandId) =>
    set((state) => ({
      paletteCommands: state.paletteCommands.filter(
        (c) => c.commandId !== commandId,
      ),
    })),

  setActivePluginPanelId: (id) => set({ activePluginPanelId: id }),

  unregisterPlugin: (pluginId) =>
    set((state) => {
      // Namespace-prefix check, NOT array-membership: by the time this
      // "belt-and-suspenders" sweep runs, the plugin's own addSidebarPanel
      // disposable has typically already called removeSidebarPanel (every
      // real caller disposes subscriptions before invoking this sweep — see
      // plugin-loader.ts unloadPlugin), so state.sidebarPanels no longer
      // contains this plugin's entry. Deriving ownership from the id's own
      // `${pluginId}:` prefix instead of from the (already-empty) array is
      // what makes this idempotent regardless of call order.
      const activeBelongsToPlugin =
        state.activePluginPanelId?.startsWith(`${pluginId}:`) ?? false;
      return {
        activePluginPanelId: activeBelongsToPlugin
          ? null
          : state.activePluginPanelId,
        fileViewers: state.fileViewers.filter((v) => v.pluginId !== pluginId),
        paletteCommands: state.paletteCommands.filter(
          (c) => c.pluginId !== pluginId,
        ),
        settingsTabs: state.settingsTabs.filter((t) => t.pluginId !== pluginId),
        sidebarPanels: state.sidebarPanels.filter(
          (p) => p.pluginId !== pluginId,
        ),
        statusBarItems: state.statusBarItems.filter(
          (i) => i.pluginId !== pluginId,
        ),
      };
    }),
}));
