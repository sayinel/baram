// §69 T5-M1 regression: unloading the active plugin settings tab must not
// leave Settings with zero highlighted nav rows + empty content.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useUIStore } from "../../../stores/ui/ui";
import { SettingsModal } from "../SettingsModal";

describe("SettingsModal — plugin settings tab unload", () => {
  beforeEach(() => {
    useUIStore.setState({ settingsOpen: true });
    usePluginUIStore.setState({ settingsTabs: [] });
  });

  it("clears activePluginTab when the active plugin tab unloads", () => {
    const onMount = vi.fn();
    act(() => {
      usePluginUIStore.setState({
        settingsTabs: [
          { onMount, pluginId: "p1", tabId: "p1:cfg", title: "Cfg" },
        ],
      });
    });
    render(<SettingsModal />);

    fireEvent.click(screen.getByText("Cfg"));
    expect(onMount).toHaveBeenCalledTimes(1);

    act(() => {
      usePluginUIStore.setState({ settingsTabs: [] });
    });

    // Plugin nav group + content must be gone, and a built-in tab's nav
    // row must be highlighted again (not zero active rows).
    expect(screen.queryByText("Cfg")).not.toBeInTheDocument();
    expect(document.querySelector(".settings-nav-active")).not.toBeNull();
  });
});
