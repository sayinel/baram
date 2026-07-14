import type { PluginManifest } from "../types";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PluginPanelHost } from "../../components/layout/PluginPanelHost";
import {
  createExtensionContext,
  unregisterPluginUI,
} from "../extension-context";
import { usePluginUIStore } from "../plugin-ui-store";

function manifest(caps: string[]): PluginManifest {
  return {
    author: "",
    capabilities: caps as PluginManifest["capabilities"],
    description: "",
    engines: { baram: ">=0.2.0" },
    id: "life",
    license: "MIT",
    main: "index.mjs",
    name: "Life",
    version: "1.0.0",
  };
}

describe("plugin UI unload lifecycle", () => {
  beforeEach(() =>
    usePluginUIStore.setState({
      activePluginPanelId: null,
      paletteCommands: [],
      settingsTabs: [],
      sidebarPanels: [],
      statusBarItems: [],
    }),
  );

  it("sweeps registries and fires onUnmount for the mounted panel on unload", () => {
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    const ctx = createExtensionContext(
      manifest(["sidebar", "settings", "commands"]),
      "/p",
    );
    ctx.ui.addSidebarPanel({ id: "n", onMount, onUnmount, title: "N" });
    ctx.ui.addSettingsTab({ id: "s", onMount: () => {}, title: "S" });
    ctx.commands.register("c", () => {}, { paletteVisible: true });
    usePluginUIStore.getState().setActivePluginPanelId("life:n");

    render(<PluginPanelHost />);
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(usePluginUIStore.getState().sidebarPanels).toHaveLength(1);
    expect(usePluginUIStore.getState().settingsTabs).toHaveLength(1);
    expect(usePluginUIStore.getState().paletteCommands).toHaveLength(1);

    // Simulate plugin unload: dispose subscriptions + sweep.
    act(() => {
      for (const d of ctx.subscriptions) d.dispose();
      unregisterPluginUI("life");
    });

    const s = usePluginUIStore.getState();
    expect(s.sidebarPanels).toHaveLength(0);
    expect(s.settingsTabs).toHaveLength(0);
    expect(s.paletteCommands).toHaveLength(0);
    expect(s.activePluginPanelId).toBeNull();
    expect(onUnmount).toHaveBeenCalledTimes(1); // React unmounted the host
  });
});
