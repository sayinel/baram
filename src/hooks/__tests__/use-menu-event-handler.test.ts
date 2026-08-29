// §479: unit tests for the View > Reload menu-event dispatch. Only the
// `view_reload` payload is exercised here — every other payload has its own
// action wired inline and is not worth a fixture per case.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../use-close-guard", () => ({
  requestReload: vi.fn(),
}));

import { listen } from "@tauri-apps/api/event";

import type { MenuEventHandlerDeps } from "../use-menu-event-handler";

import { requestReload } from "../use-close-guard";
import { useMenuEventHandler } from "../use-menu-event-handler";

function makeDeps(): MenuEventHandlerDeps {
  return {
    editor: null,
    handleCloseFolder: vi.fn(),
    handleCloseTab: vi.fn(),
    handleGoBack: vi.fn(),
    handleGoForward: vi.fn(),
    handleNewFile: vi.fn(),
    handleOpenFile: vi.fn(async () => {}),
    handleOpenFilePath: vi.fn(async () => {}),
    handleOpenFolder: vi.fn(async () => {}),
    handleSave: vi.fn(async () => {}),
    handleSaveAs: vi.fn(async () => {}),
    setFindReplaceOpen: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleQuickSwitcher: vi.fn(),
    toggleSettings: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleSourceMode: vi.fn(),
  };
}

/** Grab the callback registered by useMenuEventHandler for the native menu event. */
function menuEventHandler(): (event: { payload: string }) => void {
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === "menu-event");
  if (!call) throw new Error("menu-event listener not registered");
  return call[1] as unknown as (event: { payload: string }) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useMenuEventHandler — view_reload (§479)", () => {
  it("registers a listener for the menu-event event", () => {
    renderHook(() => useMenuEventHandler(makeDeps()));

    expect(vi.mocked(listen)).toHaveBeenCalledWith(
      "menu-event",
      expect.any(Function),
    );
  });

  it("dispatches view_reload to requestReload", async () => {
    renderHook(() => useMenuEventHandler(makeDeps()));

    await menuEventHandler()({ payload: "view_reload" });

    expect(requestReload).toHaveBeenCalledOnce();
  });
});
