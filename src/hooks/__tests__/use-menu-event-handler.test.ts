// §479/§81: unit tests for menu-event dispatch. `view_reload` and
// `file_close_folder` are here because both must reach a CLOSE GUARD rather than
// act directly — nothing else in the suite pins that, so reverting either wiring
// to the bare action would leave every test green while the user loses work.
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real `openUrl` resolves to a Promise; the handler chains `.catch()` onto
// it, so a bare `vi.fn()` (returning `undefined`) throws synchronously
// inside the `async` menu-event callback and surfaces as an unhandled
// rejection in the test run.
const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn((_url: string) => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

vi.mock("../use-close-guard", () => ({
  requestReload: vi.fn(),
}));

import { listen } from "@tauri-apps/api/event";

import type { MenuEventHandlerDeps } from "../use-menu-event-handler";

import { useUIStore } from "../../stores/ui/ui";
import { HELP_DOC_URLS } from "../../utils/help-urls";
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

// vi.clearAllMocks() only clears call records — it does not restore a
// vi.spyOn replacement on a store method. Without this, a spy installed in
// one test (e.g. on useUIStore.getState().setRightPanelMode below) would
// keep replacing the store method for every test that runs after it in
// this file.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("menu event → File > Close Workspace", () => {
  it("routes the menu payload to handleCloseFolder", () => {
    const deps = makeDeps();
    renderHook(() => useMenuEventHandler(deps));

    menuEventHandler()({ payload: "file_close_folder" });

    // The guard itself lives behind `handleCloseFolder`; this pins that the
    // native menu reaches it at all, which is the half the app runs.
    expect(deps.handleCloseFolder).toHaveBeenCalledOnce();
    expect(deps.handleCloseTab).not.toHaveBeenCalled();
  });
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

// §4.2 Help 문서는 더 이상 번들되지 않는다 — 세 항목 모두 브라우저를 연다.
// ‼️ mock openUrl 호출은 "정말로 열린다"의 증거가 아니다. 이 스위트가 고정하는 것은
// "메뉴 payload가 어느 URL로 라우팅되는가"뿐이고, URL이 실존하는 페이지인지는
// `utils/__tests__/help-urls.test.ts`가 사이트 산출물에서 파생시켜 따로 고정한다.
describe("menu event → Help (§4.2 online docs)", () => {
  it("routes each help payload to its own doc URL", () => {
    renderHook(() => useMenuEventHandler(makeDeps()));
    const fire = menuEventHandler();

    fire({ payload: "help_user_guide" });
    fire({ payload: "help_shortcuts" });
    fire({ payload: "help_faq" });

    expect(openUrl.mock.calls.map((c) => c[0])).toEqual([
      HELP_DOC_URLS.guide,
      HELP_DOC_URLS.shortcuts,
      HELP_DOC_URLS.faq,
    ]);
  });

  it("does not open or switch the right panel any more", () => {
    const setRightPanelMode = vi.spyOn(
      useUIStore.getState(),
      "setRightPanelMode",
    );
    renderHook(() => useMenuEventHandler(makeDeps()));

    menuEventHandler()({ payload: "help_user_guide" });

    expect(setRightPanelMode).not.toHaveBeenCalled();
  });
});
