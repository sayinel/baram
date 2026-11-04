import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PluginPanelHost } from "../PluginPanelHost";

describe("PluginPanelHost", () => {
  beforeEach(() =>
    usePluginUIStore.setState({ activePluginPanelId: null, sidebarPanels: [] }),
  );

  it("mounts the active plugin panel", () => {
    const onMount = vi.fn();
    usePluginUIStore.setState({
      activePluginPanelId: "p1:notes",
      sidebarPanels: [
        {
          kind: "dom" as const,
          onMount,
          panelId: "p1:notes",
          pluginId: "p1",
          title: "Notes",
        },
      ],
    });
    render(<PluginPanelHost />);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when the active panel is missing", () => {
    render(<PluginPanelHost />);
    expect(screen.getByText("No plugin panel selected.")).toBeTruthy();
  });

  it("remounts (unmount old / mount new) when the active panel switches", () => {
    const onMountA = vi.fn();
    const onUnmountA = vi.fn();
    const onMountB = vi.fn();
    const panelA = {
      kind: "dom" as const,
      onMount: onMountA,
      onUnmount: onUnmountA,
      panelId: "p1:a",
      pluginId: "p1",
      title: "Panel A",
    };
    const panelB = {
      kind: "dom" as const,
      onMount: onMountB,
      panelId: "p1:b",
      pluginId: "p1",
      title: "Panel B",
    };
    usePluginUIStore.setState({
      activePluginPanelId: "p1:a",
      sidebarPanels: [panelA, panelB],
    });
    const { rerender } = render(<PluginPanelHost />);
    expect(onMountA).toHaveBeenCalledTimes(1);

    act(() => {
      usePluginUIStore.setState({ activePluginPanelId: "p1:b" });
    });
    rerender(<PluginPanelHost />);

    expect(onUnmountA).toHaveBeenCalledTimes(1);
    expect(onMountB).toHaveBeenCalledTimes(1);
  });
});
