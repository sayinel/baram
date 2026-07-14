// §69 Plugin UI registry — plugin-registered status-bar items (runtime only)
import { create } from "zustand";

export interface PluginStatusBarItem {
  align: "left" | "right";
  itemId: string;
  pluginId: string;
  text: string;
}

interface PluginUIState {
  registerStatusBarItem: (item: PluginStatusBarItem) => void;
  removeStatusBarItem: (itemId: string) => void;
  statusBarItems: PluginStatusBarItem[];
  unregisterPlugin: (pluginId: string) => void;
  updateStatusBarItem: (itemId: string, text: string) => void;
}

export const usePluginUIStore = create<PluginUIState>()((set) => ({
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

  unregisterPlugin: (pluginId) =>
    set((state) => ({
      statusBarItems: state.statusBarItems.filter(
        (i) => i.pluginId !== pluginId,
      ),
    })),
}));
