// §69 Plugin UI registry — plugin-registered status-bar items, sidebar
// panels, settings tabs, and palette commands (runtime only)
import { create } from "zustand";

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
  itemId: string;
  pluginId: string;
  text: string;
}

interface PluginUIState {
  activePluginPanelId: null | string;
  paletteCommands: PluginPaletteCommand[];
  registerPaletteCommand: (cmd: PluginPaletteCommand) => void;
  registerSettingsTab: (tab: PluginSettingsTab) => void;
  registerSidebarPanel: (panel: PluginSidebarPanel) => void;
  registerStatusBarItem: (item: PluginStatusBarItem) => void;
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

export const usePluginUIStore = create<PluginUIState>()((set) => ({
  activePluginPanelId: null,
  paletteCommands: [],
  settingsTabs: [],
  sidebarPanels: [],
  statusBarItems: [],

  registerStatusBarItem: (item) =>
    set((state) => ({ statusBarItems: [...state.statusBarItems, item] })),

  updateStatusBarItem: (itemId, text) =>
    set((state) => ({
      statusBarItems: state.statusBarItems.map((i) =>
        i.itemId === itemId ? { ...i, text } : i,
      ),
    })),

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
      const removed = state.sidebarPanels
        .filter((p) => p.pluginId === pluginId)
        .map((p) => p.panelId);
      return {
        activePluginPanelId:
          state.activePluginPanelId &&
          removed.includes(state.activePluginPanelId)
            ? null
            : state.activePluginPanelId,
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
