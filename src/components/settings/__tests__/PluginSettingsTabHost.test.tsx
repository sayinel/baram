import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PluginSettingsTabHost } from "../PluginSettingsTabHost";

describe("PluginSettingsTabHost", () => {
  beforeEach(() => usePluginUIStore.setState({ settingsTabs: [] }));

  it("mounts the matching settings tab", () => {
    const onMount = vi.fn();
    usePluginUIStore.setState({
      settingsTabs: [
        { onMount, pluginId: "p1", tabId: "p1:cfg", title: "Cfg" },
      ],
    });
    render(<PluginSettingsTabHost tabId="p1:cfg" />);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no tab matches", () => {
    usePluginUIStore.setState({
      settingsTabs: [
        { onMount: vi.fn(), pluginId: "p1", tabId: "p1:cfg", title: "Cfg" },
      ],
    });
    const { container } = render(<PluginSettingsTabHost tabId="p1:missing" />);
    expect(container).toBeEmptyDOMElement();
  });
});
