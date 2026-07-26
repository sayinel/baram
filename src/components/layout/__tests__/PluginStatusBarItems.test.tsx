import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerHostCommandHandler } from "../../../plugins/extension-context";
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

  // §260 Phase 4a — a sandboxed plugin's declared item can carry a command, which is
  // the tier's only clickable surface (it has no DOM of its own).
  it("runs the item's command on click, and stays a plain span without one", async () => {
    const ran: unknown[] = [];
    const disposable = registerHostCommandHandler("p.recount", (...args) => {
      ran.push(args);
      return "ok";
    });
    usePluginUIStore.setState({
      statusBarItems: [
        {
          align: "right",
          command: "p.recount",
          itemId: "r1",
          pluginId: "p",
          text: "0 notes",
          tooltip: "recount",
        },
        { align: "right", itemId: "r2", pluginId: "p", text: "static" },
      ],
    });
    render(<PluginStatusBarItems align="right" />);

    const button = screen.getByRole("button", { name: "0 notes" });
    expect(button).toHaveAttribute("title", "recount");
    button.click();
    expect(ran).toEqual([[]]);

    // The item without a command is not focusable or clickable at all.
    expect(screen.queryByRole("button", { name: "static" })).toBeNull();
    disposable.dispose();
  });

  it("disables a pending item so a click cannot silently do nothing", async () => {
    // §260 Phase 4a security re-review (LOW-5) — declared items are registered before
    // the sandbox activates, so for a moment the command they name does not exist.
    usePluginUIStore.setState({
      statusBarItems: [
        {
          align: "right",
          command: "p.later",
          itemId: "r1",
          pending: true,
          pluginId: "p",
          text: "starting",
          tooltip: "real tooltip",
        },
      ],
    });
    render(<PluginStatusBarItems align="right" />);
    const button = screen.getByRole("button", { name: "starting" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Plugin is still starting…");
  });

  it("does not let a failing command escape into React", async () => {
    // The handler forwards to `session.invokeCommand`, whose rejection is the plugin's
    // problem: an unhandled rejection in an onClick would surface as an app error.
    const disposable = registerHostCommandHandler("p.boom", () =>
      Promise.reject(new Error("sandbox is gone")),
    );
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      usePluginUIStore.setState({
        statusBarItems: [
          {
            align: "right",
            command: "p.boom",
            itemId: "r1",
            pluginId: "p",
            text: "boom",
          },
        ],
      });
      render(<PluginStatusBarItems align="right" />);
      screen.getByRole("button", { name: "boom" }).click();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      disposable.dispose();
    }
  });
});
