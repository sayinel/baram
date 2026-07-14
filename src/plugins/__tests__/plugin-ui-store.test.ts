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
