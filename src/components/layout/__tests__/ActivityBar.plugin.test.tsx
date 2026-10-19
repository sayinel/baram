import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useUIStore } from "../../../stores/ui/ui";
import { ActivityBar } from "../ActivityBar";

describe("ActivityBar plugin panels", () => {
  beforeEach(() => {
    usePluginUIStore.setState({ activePluginPanelId: null, sidebarPanels: [] });
    useUIStore.setState({ sidebarOpen: true, sidebarPanel: "files" });
  });

  it("renders a button for a registered plugin panel and activates it on click", () => {
    usePluginUIStore.setState({
      sidebarPanels: [
        {
          icon: "🔌",
          kind: "dom" as const,
          onMount: () => {},
          panelId: "p1:notes",
          pluginId: "p1",
          title: "My Notes",
        },
      ],
    });
    render(<ActivityBar />);
    const btn = screen.getByRole("button", { name: "My Notes" });
    fireEvent.click(btn);
    expect(useUIStore.getState().sidebarPanel).toBe("plugin");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p1:notes");
  });

  it("switching between two plugin panels does not close the sidebar", () => {
    const panelA = {
      icon: "🔌",
      kind: "dom" as const,
      onMount: () => {},
      panelId: "p1:a",
      pluginId: "p1",
      title: "Panel A",
    };
    const panelB = {
      icon: "🔌",
      kind: "dom" as const,
      onMount: () => {},
      panelId: "p1:b",
      pluginId: "p1",
      title: "Panel B",
    };
    useUIStore.setState({ sidebarOpen: true, sidebarPanel: "plugin" });
    usePluginUIStore.setState({
      activePluginPanelId: "p1:a",
      sidebarPanels: [panelA, panelB],
    });
    render(<ActivityBar />);
    const btnB = screen.getByRole("button", { name: "Panel B" });
    fireEvent.click(btnB);
    // A naive handlePanelClick("plugin") reuse would toggle-close here since
    // sidebarPanel === "plugin" already; the dedicated handler must not.
    expect(useUIStore.getState().sidebarOpen).toBe(true);
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p1:b");
    expect(useUIStore.getState().sidebarPanel).toBe("plugin");
  });

  it("re-clicking the already-active plugin panel closes the sidebar", () => {
    const panelA = {
      icon: "🔌",
      kind: "dom" as const,
      onMount: () => {},
      panelId: "p1:a",
      pluginId: "p1",
      title: "Panel A",
    };
    useUIStore.setState({ sidebarOpen: true, sidebarPanel: "plugin" });
    usePluginUIStore.setState({
      activePluginPanelId: "p1:a",
      sidebarPanels: [panelA],
    });
    render(<ActivityBar />);
    const btnA = screen.getByRole("button", { name: "Panel A" });
    fireEvent.click(btnA);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  /** P6 — a sandboxed panel's button names its plugin: its title and icon are the plugin's and could
   *  copy one of the app's panels. What fails this: a label of the title alone. The pair: a trusted
   *  panel's label is its title (the first row of this file). */
  it("names the plugin on a sandboxed panel's button", () => {
    usePluginUIStore.setState({
      sidebarPanels: [
        {
          kind: "rendered",
          panelId: "sb:recent",
          pluginId: "sb",
          sourceName: "SB",
          title: "Recent",
        },
      ],
    });
    render(<ActivityBar />);
    expect(
      screen.getByRole("button", { name: "Recent · Plugin · SB" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recent" })).toBeNull();
  });
});
