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
});
