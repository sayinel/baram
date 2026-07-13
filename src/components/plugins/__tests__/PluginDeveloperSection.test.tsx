import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const open = vi.fn(async () => "/dev/dev-x");
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => open(...a),
}));

const addDevFolder = vi.fn(async () => ({
  install_path: "/dev/dev-x",
  checksum: "",
  is_dev: true,
  manifest: {
    id: "dev-x",
    name: "Dev X",
    description: "",
    version: "1.0.0",
    author: "",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: [],
  },
}));
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginAddDevFolder: (...a: unknown[]) => addDevFolder(...a),
  pluginRemoveDevFolder: vi.fn(async () => {}),
}));
vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: vi.fn(async () => {}),
    reloadPlugin: vi.fn(async () => {}),
    unloadPlugin: vi.fn(async () => {}),
  },
}));

import { PluginDeveloperSection } from "../PluginDeveloperSection";

describe("PluginDeveloperSection", () => {
  it("loads a dev plugin folder via the dialog", async () => {
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByRole("button", { name: /load dev plugin folder/i }),
    );
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith({ directory: true }),
    );
    await vi.waitFor(() =>
      expect(addDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
  });
});
