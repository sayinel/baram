import type { PluginManifest } from "../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn(async (..._a: unknown[]) => "/dev/dev-x");
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => open(...a),
}));

const baseManifest: PluginManifest = {
  id: "dev-x",
  name: "Dev X",
  description: "",
  version: "1.0.0",
  author: "",
  license: "MIT",
  main: "index.mjs",
  engines: { baram: ">=0.2.0" },
  capabilities: [],
};

const addDevFolder = vi.fn(async (..._a: unknown[]) => ({
  install_path: "/dev/dev-x",
  checksum: "",
  is_dev: true,
  manifest: baseManifest,
}));
const removeDevFolder = vi.fn(async (..._a: unknown[]) => {});

// Keep the real `toInstalledDevPlugin` mapper (Fix5: shared, pure, no invoke()
// calls) so the component's actual transform logic runs under test; only the
// Tauri-invoking wrappers are mocked.
vi.mock("../../../ipc/plugin-invoke", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../ipc/plugin-invoke")>();
  return {
    ...actual,
    pluginAddDevFolder: (...a: unknown[]) => addDevFolder(...a),
    pluginRemoveDevFolder: (...a: unknown[]) => removeDevFolder(...a),
  };
});

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: {
    loadPlugin: vi.fn(async () => {}),
    reloadPlugin: vi.fn(async () => {}),
    unloadPlugin: vi.fn(async () => {}),
  },
}));

import { pluginLoader } from "../../../plugins/plugin-loader";
import { usePluginStore } from "../../../stores/system/plugin";
import { useUIStore } from "../../../stores/ui/ui";
import { PluginDeveloperSection } from "../PluginDeveloperSection";

function makeDevPlugin(manifest: PluginManifest = baseManifest) {
  return {
    checksum: "",
    enabled: true,
    installedAt: 0,
    installPath: "/dev/dev-x",
    isDev: true,
    manifest,
    updatedAt: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  open.mockResolvedValue("/dev/dev-x");
  addDevFolder.mockResolvedValue({
    install_path: "/dev/dev-x",
    checksum: "",
    is_dev: true,
    manifest: baseManifest,
  });
  removeDevFolder.mockResolvedValue(undefined);
  usePluginStore.setState({ devPlugins: {} });
});

describe("PluginDeveloperSection", () => {
  it("loads a dev plugin folder via the dialog", async () => {
    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByRole("button", { name: /load dev plugin folder/i }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledWith({ directory: true }));
    await waitFor(() =>
      expect(addDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
  });

  it("shows a failure toast when loading a dev plugin folder fails", async () => {
    addDevFolder.mockRejectedValue(new Error("boom"));
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    render(<PluginDeveloperSection />);
    fireEvent.click(
      screen.getByRole("button", { name: /load dev plugin folder/i }),
    );

    await waitFor(() =>
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load dev plugin"),
      ),
    );
  });

  it("reloads a dev plugin without Tiptap extensions and shows a plain toast", async () => {
    usePluginStore.getState().setDevPlugins([makeDevPlugin()]);
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByText("Dev X"));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(addDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
    await waitFor(() =>
      expect(pluginLoader.reloadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        baseManifest,
      ),
    );
    await waitFor(() =>
      expect(showToastSpy).toHaveBeenCalledWith("Reloaded dev plugin: Dev X"),
    );
    expect(
      showToastSpy.mock.calls.some((call) =>
        String(call[0]).includes("restart required"),
      ),
    ).toBe(false);
  });

  it("reloads a dev plugin with Tiptap extensions and warns a restart is required", async () => {
    const manifestWithTiptap: PluginManifest = {
      ...baseManifest,
      tiptapExtensions: [{ type: "node", name: "x", exportName: "X" }],
    };
    usePluginStore.getState().setDevPlugins([makeDevPlugin()]);
    addDevFolder.mockResolvedValue({
      install_path: "/dev/dev-x",
      checksum: "",
      is_dev: true,
      manifest: manifestWithTiptap,
    });
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");

    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByText("Dev X"));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() =>
      expect(pluginLoader.reloadPlugin).toHaveBeenCalledWith(
        "/dev/dev-x",
        manifestWithTiptap,
      ),
    );
    await waitFor(() =>
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("restart required"),
      ),
    );
  });

  it("removes a dev plugin and unloads it", async () => {
    usePluginStore.getState().setDevPlugins([makeDevPlugin()]);

    render(<PluginDeveloperSection />);
    expect(screen.getByText("Dev X")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dev X"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(removeDevFolder).toHaveBeenCalledWith("/dev/dev-x"),
    );
    await waitFor(() =>
      expect(pluginLoader.unloadPlugin).toHaveBeenCalledWith("dev-x"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Dev X")).not.toBeInTheDocument(),
    );
  });
});
