import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../plugin-ui-store";

const item = (itemId: string, pluginId = "p1") => ({
  align: "right" as const,
  itemId,
  pluginId,
  text: "hi",
});

describe("plugin-ui-store status bar items", () => {
  beforeEach(() => usePluginUIStore.setState({ statusBarItems: [] }));

  it("registers, updates, and removes an item", () => {
    usePluginUIStore.getState().registerStatusBarItem(item("a"));
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(1);

    usePluginUIStore.getState().updateStatusBarItem("a", "bye");
    expect(usePluginUIStore.getState().statusBarItems[0].text).toBe("bye");

    usePluginUIStore.getState().removeStatusBarItem("a");
    expect(usePluginUIStore.getState().statusBarItems).toHaveLength(0);
  });

  it("unregisterPlugin drops all items for a plugin", () => {
    usePluginUIStore.getState().registerStatusBarItem(item("a", "p1"));
    usePluginUIStore.getState().registerStatusBarItem(item("b", "p2"));
    usePluginUIStore.getState().registerStatusBarItem(item("c", "p1"));
    usePluginUIStore.getState().unregisterPlugin("p1");
    const remaining = usePluginUIStore.getState().statusBarItems;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pluginId).toBe("p2");
  });
});

const panel = (id: string, pluginId = "p1") => ({
  onMount: () => {},
  panelId: `${pluginId}:${id}`,
  pluginId,
  title: id,
});
const tab = (id: string, pluginId = "p1") => ({
  onMount: () => {},
  pluginId,
  tabId: `${pluginId}:${id}`,
  title: id,
});
const cmd = (id: string, pluginId = "p1") => ({
  commandId: `${pluginId}.${id}`,
  pluginId,
  title: id,
});

describe("plugin-ui-store panels/tabs/palette", () => {
  beforeEach(() =>
    usePluginUIStore.setState({
      activePluginPanelId: null,
      paletteCommands: [],
      settingsTabs: [],
      sidebarPanels: [],
      statusBarItems: [],
    }),
  );

  it("registers and removes a sidebar panel", () => {
    usePluginUIStore.getState().registerSidebarPanel(panel("a"));
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(1);
    usePluginUIStore.getState().removeSidebarPanel("p1:a");
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(0);
  });

  it("registers/removes settings tabs and palette commands", () => {
    usePluginUIStore.getState().registerSettingsTab(tab("s"));
    usePluginUIStore.getState().registerPaletteCommand(cmd("c"));
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(1);
    expect(usePluginUIStore.getState().paletteCommands).toHaveLength(1);
    usePluginUIStore.getState().removeSettingsTab("p1:s");
    usePluginUIStore.getState().removePaletteCommand("p1.c");
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(0);
    expect(usePluginUIStore.getState().paletteCommands).toHaveLength(0);
  });

  it("setActivePluginPanelId tracks the active panel", () => {
    usePluginUIStore.getState().setActivePluginPanelId("p1:a");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p1:a");
  });

  it("unregisterPlugin sweeps all registries and clears active id for that plugin", () => {
    usePluginUIStore.getState().registerSidebarPanel(panel("a", "p1"));
    usePluginUIStore.getState().registerSidebarPanel(panel("b", "p2"));
    usePluginUIStore.getState().registerSettingsTab(tab("s", "p1"));
    usePluginUIStore.getState().registerPaletteCommand(cmd("c", "p1"));
    usePluginUIStore.getState().setActivePluginPanelId("p1:a");

    usePluginUIStore.getState().unregisterPlugin("p1");

    const s = usePluginUIStore.getState();
    expect(s.sidebarPanels.map((p) => p.pluginId)).toEqual(["p2"]);
    expect(s.settingsTabs).toHaveLength(0);
    expect(s.paletteCommands).toHaveLength(0);
    expect(s.activePluginPanelId).toBeNull(); // active belonged to p1
  });

  it("unregisterPlugin keeps active id when it belongs to another plugin", () => {
    usePluginUIStore.getState().registerSidebarPanel(panel("b", "p2"));
    usePluginUIStore.getState().setActivePluginPanelId("p2:b");
    usePluginUIStore.getState().unregisterPlugin("p1");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p2:b");
  });
});
