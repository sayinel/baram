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

import type { FeatureKey } from "../../stores/settings/feature-keys";
import type { MenuEventHandlerDeps } from "../use-menu-event-handler";

import { t } from "../../i18n";
import { MENU_FEATURE_MAP } from "../../ipc/menu-enabled";
import {
  clearActions,
  registerAction,
} from "../../keybindings/keybinding-actions";
import { useAIStore } from "../../stores/ai/ai";
import { useWorkspaceStore } from "../../stores/file/workspace";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { FEATURE_DISABLED_TOAST_KEY } from "../../utils/feature-gate";
import { BARAM_HOMEPAGE, helpDocUrl } from "../../utils/help-urls";
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
  // The view_inline_ai probe below registers a fake "insert.inlineAI" action in the
  // real (module-level, non-mocked) keybinding registry — clear it so it cannot leak
  // into a later test.
  clearActions();
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
      helpDocUrl("guide", "en"),
      helpDocUrl("shortcuts", "en"),
      helpDocUrl("faq", "en"),
    ]);
  });

  it("opens the help doc in the app language, read at dispatch time", () => {
    // ‼️ 로케일을 훅 마운트 시점에 캡처하면 이 테스트가 통과한다 — 그래서 렌더 **뒤에**
    // 언어를 바꾸고 그때 열리는 URL 을 본다. 캡처 구현은 여기서 깨진다.
    renderHook(() => useMenuEventHandler(makeDeps()));
    const fire = menuEventHandler();

    useSettingsStore.setState({ locale: "ko" });
    fire({ payload: "help_user_guide" });

    expect(openUrl).toHaveBeenLastCalledWith(helpDocUrl("guide", "ko"));
    expect(openUrl).not.toHaveBeenLastCalledWith(helpDocUrl("guide", "en"));

    useSettingsStore.setState({ locale: "en" });
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

  it("routes help_homepage to the site root", () => {
    renderHook(() => useMenuEventHandler(makeDeps()));

    menuEventHandler()({ payload: "help_homepage" });

    expect(openUrl).toHaveBeenCalledWith(BARAM_HOMEPAGE);
  });
});

// §341 The native menu lives outside the webview: its accelerators (⌘⇧A, ⌘J,
// ⌘⌥2, ⌘⌥3) fire regardless of what any DOM button shows, so greying an item
// out (src-tauri `update_menu_enabled`) is one layer and this handler-side
// guard is the second — it must hold even if the native disable is bypassed.
describe("menu event → feature-owned ids gated by their feature flag (§341)", () => {
  // Each id's own way of proving its switch-case body never ran — a bare "a toast
  // appeared" check would pass even if the case fired and ALSO happened to toast, so
  // every entry spies (or, for view_inline_ai, fakes) the SPECIFIC call that id's own
  // handler makes.
  const ASSERT_NOT_FIRED: Record<string, () => () => void> = {
    view_ai_chat: () => {
      const spy = vi.spyOn(useUIStore.getState(), "setRightPanelMode");
      return () => expect(spy).not.toHaveBeenCalled();
    },
    view_calendar: () => {
      const spy = vi.spyOn(useUIStore.getState(), "setSidebarPanel");
      return () => expect(spy).not.toHaveBeenCalled();
    },
    view_inline_ai: () => {
      const fn = vi.fn();
      registerAction("insert.inlineAI", fn);
      return () => expect(fn).not.toHaveBeenCalled();
    },
    workspace_journal: () => {
      const spy = vi.spyOn(useWorkspaceStore.getState(), "applyPreset");
      return () => expect(spy).not.toHaveBeenCalled();
    },
    workspace_zettel: () => {
      const spy = vi.spyOn(useWorkspaceStore.getState(), "applyPreset");
      return () => expect(spy).not.toHaveBeenCalled();
    },
  };

  const DISABLE_FEATURE: Record<FeatureKey, () => void> = {
    ai: () => useAIStore.setState({ aiEnabled: false }),
    journal: () => useSettingsStore.setState({ journalEnabled: false }),
    tasks: () => useSettingsStore.setState({ tasksEnabled: false }),
    zettelkasten: () =>
      useSettingsStore.setState({ zettelkastenEnabled: false }),
  };
  const ENABLE_FEATURE: Record<FeatureKey, () => void> = {
    ai: () => useAIStore.setState({ aiEnabled: true }),
    journal: () => useSettingsStore.setState({ journalEnabled: true }),
    tasks: () => useSettingsStore.setState({ tasksEnabled: true }),
    zettelkasten: () =>
      useSettingsStore.setState({ zettelkastenEnabled: true }),
  };

  // ‼️ (Fix E / M-10) Derived from MENU_FEATURE_MAP rather than hand-listed — a
  // hand-written case per id is exactly the shape that left view_calendar and
  // view_inline_ai uncovered (only 3 of the map's 5 ids had one). A derived sweep
  // alone still cannot catch a WRONG map VALUE, though: disable the (wrong) feature
  // the map itself names and re-check against that same wrong value, and it still
  // passes. `menu-enabled.test.ts`'s "every key is an id menu.rs actually registers
  // as a menu item" is the independent oracle for this exact map, read from the Rust
  // source rather than re-derived here — the two files share the one MENU_FEATURE_MAP
  // object, so that check already covers this file's import of it too.
  it.each(Object.entries(MENU_FEATURE_MAP))(
    "blocks %s and toasts when its owning feature (%s) is disabled",
    (id, feature) => {
      DISABLE_FEATURE[feature]();
      const showToast = vi.spyOn(useUIStore.getState(), "showToast");
      const assertNotFired = ASSERT_NOT_FIRED[id]();
      renderHook(() => useMenuEventHandler(makeDeps()));

      menuEventHandler()({ payload: id });

      assertNotFired();
      const toastKey = FEATURE_DISABLED_TOAST_KEY[feature];
      if (!toastKey) {
        throw new Error(
          `no FEATURE_DISABLED_TOAST_KEY entry for "${feature}" (owns ${id}) — every feature reachable through MENU_FEATURE_MAP must have one, or blocking it is a silent no-op (§18.19 결함 A)`,
        );
      }
      expect(showToast).toHaveBeenCalledWith(t(toastKey, "en"));

      ENABLE_FEATURE[feature]();
    },
  );

  it("lets workspace_journal through once journal is enabled", () => {
    useSettingsStore.setState({ journalEnabled: true });
    const applyPreset = vi.spyOn(useWorkspaceStore.getState(), "applyPreset");
    renderHook(() => useMenuEventHandler(makeDeps()));

    menuEventHandler()({ payload: "workspace_journal" });

    expect(applyPreset).toHaveBeenCalledWith("journal");
    useSettingsStore.setState({ journalEnabled: false });
  });

  it("lets view_ai_chat through once ai is enabled", () => {
    useAIStore.setState({ aiEnabled: true });
    const setRightPanelMode = vi.spyOn(
      useUIStore.getState(),
      "setRightPanelMode",
    );
    renderHook(() => useMenuEventHandler(makeDeps()));

    menuEventHandler()({ payload: "view_ai_chat" });

    expect(setRightPanelMode).toHaveBeenCalledWith("chat");
  });

  it("does not gate insert_task_list — it is an editing command, not the tasks feature", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    renderHook(() => useMenuEventHandler(makeDeps()));

    // No editor means the case body no-ops either way; this pins that the
    // payload is not intercepted by the feature guard before reaching it.
    const showToast = vi.spyOn(useUIStore.getState(), "showToast");
    menuEventHandler()({ payload: "insert_task_list" });

    expect(showToast).not.toHaveBeenCalled();
    useSettingsStore.setState({ tasksEnabled: true });
  });
});
