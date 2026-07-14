import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { PluginStatusBarItems } from "../PluginStatusBarItems";

describe("PluginStatusBarItems", () => {
  beforeEach(() => usePluginUIStore.setState({ statusBarItems: [] }));

  it("renders only items matching the alignment", () => {
    usePluginUIStore.setState({
      statusBarItems: [
        { align: "right", itemId: "r1", pluginId: "p", text: "RightItem" },
        { align: "left", itemId: "l1", pluginId: "p", text: "LeftItem" },
      ],
    });
    render(<PluginStatusBarItems align="right" />);
    expect(screen.getByText("RightItem")).toBeInTheDocument();
    expect(screen.queryByText("LeftItem")).not.toBeInTheDocument();
  });

  it("renders nothing when no items match", () => {
    const { container } = render(<PluginStatusBarItems align="left" />);
    expect(container).toBeEmptyDOMElement();
  });
});
