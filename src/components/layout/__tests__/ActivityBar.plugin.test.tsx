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
          onMount: () => {},
          panelId: "p1:notes",
          pluginId: "p1",
          title: "My Notes",
        },
      ],
    });
    render(<ActivityBar />);
    const btn = screen.getByTitle("My Notes");
    fireEvent.click(btn);
    expect(useUIStore.getState().sidebarPanel).toBe("plugin");
    expect(usePluginUIStore.getState().activePluginPanelId).toBe("p1:notes");
  });

  it("switching between two plugin panels does not close the sidebar", () => {
    const panelA = {
      icon: "🔌",
      onMount: () => {},
      panelId: "p1:a",
      pluginId: "p1",
      title: "Panel A",
    };
    const panelB = {
      icon: "🔌",
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
    const btnB = screen.getByTitle("Panel B");
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
    const btnA = screen.getByTitle("Panel A");
    fireEvent.click(btnA);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });
});
