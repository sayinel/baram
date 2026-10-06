import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../../plugins/extension-context", () => ({
  executePluginCommand: (...a: unknown[]) => execute(...a),
}));

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useUIStore } from "../../../stores/ui/ui";
import { CommandPalette } from "../CommandPalette";

const noop = () => {};

describe("CommandPalette plugin commands", () => {
  beforeEach(() => {
    usePluginUIStore.setState({ paletteCommands: [] });
    useUIStore.setState({ commandPaletteOpen: true });
    execute.mockClear();
  });

  it("lists a plugin palette command and dispatches it", () => {
    usePluginUIStore.setState({
      paletteCommands: [
        { commandId: "p1.hello", pluginId: "p1", title: "Say Hello" },
      ],
    });
    render(
      <CommandPalette
        editor={null}
        onCloseFolder={noop}
        onNewFile={noop}
        onOpenFile={noop}
        onOpenFolder={noop}
        onSave={noop}
        onToggleSourceMode={noop}
      />,
    );
    fireEvent.click(screen.getByText("Say Hello"));
    expect(execute).toHaveBeenCalledWith("p1.hello");
  });

  it("D16 — draws a plugin title without bidi or control characters, capped at 64", () => {
    usePluginUIStore.setState({
      paletteCommands: [
        { commandId: "p1.a", pluginId: "p1", title: "\u202Eevil\u0007 cmd" },
        { commandId: "p1.b", pluginId: "p1", title: "w".repeat(80) },
      ],
    });
    render(
      <CommandPalette
        editor={null}
        onCloseFolder={noop}
        onNewFile={noop}
        onOpenFile={noop}
        onOpenFolder={noop}
        onSave={noop}
        onToggleSourceMode={noop}
      />,
    );
    const labels = [...document.querySelectorAll(".command-item-label")].map(
      (n) => n.textContent ?? "",
    );
    expect(labels).toContain("evil  cmd");
    expect(labels).toContain(`${"w".repeat(63)}…`);
    expect(labels.join("")).not.toContain("\u202E");
    expect(labels.join("")).not.toContain("\u0007");
  });
});
