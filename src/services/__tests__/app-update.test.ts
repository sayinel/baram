import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.hoisted(() => vi.fn());
const relaunchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const openUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
const flushChatPersistMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { useAppUpdateStore } from "../../stores/system/app-update";
import { useUIStore } from "../../stores/ui/ui";
import { trackBlockIdRename } from "../../utils/editor/block-id-rename-landing";
import { registerExitSave } from "../app-exit";
import {
  checkForAppUpdate,
  installAppUpdate,
  installDownloadedUpdate,
  runPeriodicCheck,
  startAppUpdateChecker,
  stopAppUpdateChecker,
} from "../app-update";

// §44 Every exit waits for the saves registered with `registerExitSave`; this test's save
// stands in for the chat history's, which `stores/ai/chat` registers when it loads.
let unregisterSave = () => {};
beforeEach(() => {
  unregisterSave = registerExitSave({
    save: () => flushChatPersistMock(),
    state: () => null,
  });
});
afterEach(() => unregisterSave());

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

const originalPlatform = navigator.platform;

beforeEach(() => {
  checkMock.mockReset();
  relaunchMock.mockReset().mockResolvedValue(undefined);
  openUrlMock.mockReset().mockResolvedValue(undefined);
  useAppUpdateStore.setState({
    status: "idle",
    availableVersion: null,
    notes: null,
    progress: null,
    lastCheckedAt: null,
    error: null,
    dialogOpen: false,
    fallbackOpened: false,
  });
  useUIStore.setState({ conflictModal: null, toast: null, unsavedModal: null });
  useSettingsStore.setState({ autoCheckUpdates: true });
  useEditorStore.setState({
    activeTabId: null,
    sourceEditedTabs: [],
    tabs: [],
  });
});

afterEach(() => {
  stopAppUpdateChecker();
  setPlatform(originalPlatform);
});

describe("checkForAppUpdate", () => {
  it("manual check with an update available opens the dialog (no toast)", async () => {
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: "notes",
      download: vi.fn(),
      install: vi.fn(),
    });

    await checkForAppUpdate(true);

    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.availableVersion).toBe("0.4.0");
    expect(s.dialogOpen).toBe(true);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("auto check with an update available toasts but does not open the dialog", async () => {
    checkMock.mockResolvedValue({
      version: "0.5.0",
      body: null,
      download: vi.fn(),
      install: vi.fn(),
    });

    await checkForAppUpdate(false);

    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.dialogOpen).toBe(false);
    expect(useUIStore.getState().toast?.message).toContain("0.5.0");
  });

  it("manual check when up to date shows a toast", async () => {
    checkMock.mockResolvedValue(null);

    await checkForAppUpdate(true);

    expect(useAppUpdateStore.getState().status).toBe("upToDate");
    expect(useUIStore.getState().toast).not.toBeNull();
  });

  it("auto check when up to date stays silent", async () => {
    checkMock.mockResolvedValue(null);

    await checkForAppUpdate(false);

    expect(useAppUpdateStore.getState().status).toBe("upToDate");
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("manual check failure sets error status and an error toast", async () => {
    checkMock.mockRejectedValue(new Error("network down"));

    await checkForAppUpdate(true);

    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("network down");
    expect(useUIStore.getState().toast?.type).toBe("error");
  });

  it("auto check failure sets error status but stays silent", async () => {
    checkMock.mockRejectedValue(new Error("network down"));

    await checkForAppUpdate(false);

    expect(useAppUpdateStore.getState().status).toBe("error");
    expect(useUIStore.getState().toast).toBeNull();
  });
});

describe("installAppUpdate — platform branching", () => {
  // §206 macOS installs in place like every other platform. It did not until
  // now: releases were ad-hoc signed, which gave the bundle no identity that
  // survived a rebuild, so replacing it reset the TCC folder grant. Releases
  // have been Developer ID signed and notarized since v0.6.0, so the reason
  // for the exception is gone — see dev/guides/auto-update-206.md for the hop
  // verification this shipped with.
  it("macOS downloads, installs, and relaunches in place", async () => {
    const download = vi.fn().mockImplementation(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });
    const install = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download,
      install,
    });
    await checkForAppUpdate(true);

    setPlatform("MacIntel");
    await installAppUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().progress).toEqual({
      downloaded: 100,
      total: 100,
    });
  });

  // §44 The relaunch takes the webview with it, so the chat history is saved first (#800).
  // 이것을 실패시키는 것: app-update.ts 가 `relaunchApp()` 대신 plugin 의 `relaunch()` 를 바로 부르면 저장
  // 없이 다시 시작한다.
  it("saves the chat history before relaunching", async () => {
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    });
    await checkForAppUpdate(true);
    flushChatPersistMock.mockClear();

    await installAppUpdate();

    expect(relaunchMock).toHaveBeenCalledOnce();
    const saves = flushChatPersistMock.mock.invocationCallOrder;
    expect(saves.at(-1)).toBeLessThan(relaunchMock.mock.invocationCallOrder[0]);
  });

  // §44 #800 review: on Windows the plugin's install starts the installer and ends the
  // process (`std::process::exit(0)`), so nothing after it runs — the save must come first.
  // Stood in for here by an install that never returns.
  // 이것을 실패시키는 것: app-update.ts 가 설치 앞의 `saveBeforeExit()` 를 빼고 `relaunchApp()` 에만 맡긴다
  // (돌아오지 않는 설치에서는 저장이 0번이 된다).
  it("saves the chat history before an install that never returns", async () => {
    const install = vi.fn(() => new Promise<void>(() => {}));
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download: vi.fn().mockResolvedValue(undefined),
      install,
    });
    await checkForAppUpdate(true);
    flushChatPersistMock.mockClear();

    setPlatform("Win32");
    void installAppUpdate();
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());

    expect(flushChatPersistMock).toHaveBeenCalledOnce();
    expect(flushChatPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
      install.mock.invocationCallOrder[0],
    );
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  // §44 A failure after the install is not an install failure: the releases page would only
  // offer the version that is already installed (#800).
  // 이것을 실패시키는 것: app-update.ts 에서 relaunchApp() 을 설치와 같은 try 로 되돌리면 재시작 실패가 설치
  // 실패로 보고되고 releases 페이지가 열린다.
  it("a failed relaunch after a good install asks for a manual restart", async () => {
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    });
    await checkForAppUpdate(true);
    relaunchMock.mockRejectedValueOnce(new Error("relaunch refused"));

    await installAppUpdate();

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().status).toBe("installed");
    expect(useAppUpdateStore.getState().fallbackOpened).toBe(false);
  });

  // The fallback is platform-independent: if the in-place install throws on
  // macOS the way it does for a Linux deb, the user must still reach the
  // download. Pinned separately because the mac path no longer has a branch of
  // its own that could carry it.
  it("macOS install failure falls back to the releases page", async () => {
    const install = vi
      .fn()
      .mockRejectedValue(new Error("bundle replace failed"));
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download: vi.fn().mockResolvedValue(undefined),
      install,
    });
    await checkForAppUpdate(true);

    setPlatform("MacIntel");
    await installAppUpdate();

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/sayinel/baram/releases/latest",
    );
    expect(relaunchMock).not.toHaveBeenCalled();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.fallbackOpened).toBe(true);
  });

  it("Windows downloads, installs, and relaunches", async () => {
    const download = vi.fn().mockImplementation(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });
    const install = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download,
      install,
    });
    await checkForAppUpdate(true);

    setPlatform("Win32");
    await installAppUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().progress).toEqual({
      downloaded: 100,
      total: 100,
    });
  });

  it("Linux install failure (e.g. deb/rpm) falls back to the releases page", async () => {
    const install = vi
      .fn()
      .mockRejectedValue(new Error("unsupported package format"));
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download: vi.fn().mockResolvedValue(undefined),
      install,
    });
    await checkForAppUpdate(true);

    setPlatform("Linux x86_64");
    await installAppUpdate();

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/sayinel/baram/releases/latest",
    );
    expect(relaunchMock).not.toHaveBeenCalled();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.fallbackOpened).toBe(true);
  });
});

// §206 Installing ends this process on every platform, and nothing on that way out asks about
// unsaved work: on Windows the plugin's install calls `std::process::exit(0)`, and elsewhere
// `relaunch()` arrives as `ExitRequested { code: Some(RESTART_EXIT_CODE) }`, which the guard in
// `src-tauri/src/lib.rs` lets through because it acts only on `code.is_none()`.
describe("installAppUpdate — unsaved work", () => {
  function fileTab(id: string, isDirty: boolean): EditorTab {
    return {
      contextId: "ctx",
      filePath: `/v/${id}.md`,
      id,
      isDirty,
      isPinned: false,
      title: `${id}.md`,
      type: "file",
    };
  }

  async function findUpdate() {
    const download = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      download,
      install,
    });
    await checkForAppUpdate(true);
    return { download, install };
  }

  // 이것을 실패시키는 것: `installAppUpdate` 에서 `hasUnsavedTabs()` 분기를 지우면 install 이 불린다.
  it("a dirty tab holds the install back and asks", async () => {
    const { download, install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", true)] });

    await installAppUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
    // The dialog beneath is not busy: Cancel leaves it where the button works again.
    expect(useAppUpdateStore.getState().status).toBe("available");
  });

  // A dirty BACKGROUND tab is the case auto-save does not reach while it stays there:
  // `use-auto-save.ts` returns from `save()` once the tab that scheduled it is no longer active.
  it("asks about a background tab, not only the active one", async () => {
    const { install } = await findUpdate();
    useEditorStore.setState({
      activeTabId: "a",
      tabs: [fileTab("a", false), fileTab("b", true)],
    });

    await installAppUpdate();

    expect(install).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // 이것을 실패시키는 것: 판정을 `isTabUnsaved` 대신 `tab.isDirty` 로 하면 소스 모드 편집을 놓친다.
  it("asks about source-mode edits, which do not raise isDirty", async () => {
    const { install } = await findUpdate();
    useEditorStore.setState({
      sourceEditedTabs: ["a"],
      tabs: [fileTab("a", false)],
    });

    await installAppUpdate();

    expect(install).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // 이것을 실패시키는 것: 판정을 download 앞으로 옮기면 내려받는 동안 생긴 편집을 놓친다 — 그 편집은
  // 묻는 시점과 프로세스가 끝나는 시점 사이에 있다.
  it("asks about an edit made while the download ran", async () => {
    const { download, install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", false)] });
    download.mockImplementation(async () => {
      useEditorStore.getState().markDirty("a", true);
    });

    await installAppUpdate();

    expect(install).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // 이것을 실패시키는 것: `hasUnsavedTabs` 에서 `awaitBlockIdRenames()` 를 빼면 착지 전에 판정한다.
  it("waits for a block ID rename, which marks its tab dirty as it lands", async () => {
    const { install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", false)] });
    let land = () => {};
    trackBlockIdRename(
      "a",
      { newId: "new", oldId: "old" },
      new Promise<void>((resolve) => {
        land = () => {
          useEditorStore.getState().markDirty("a", true);
          resolve();
        };
      }),
    );

    const installing = installAppUpdate();
    // A macrotask, so every microtask has run: without the barrier it has already judged and
    // installed by now.
    await new Promise((resolve) => setTimeout(resolve));
    expect(install).not.toHaveBeenCalled();
    land();
    await installing;

    expect(install).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // 긍정 짝: 위 판정들이 "무조건 묻는다" 로 통과한 것이 아님을 고정한다.
  it("installs without asking when no tab holds unsaved work", async () => {
    const { install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", false)] });

    await installAppUpdate();

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(install).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  it("installs from the package already downloaded once the question is answered", async () => {
    const { download, install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", true)] });
    await installAppUpdate();

    await installDownloadedUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  // 이것을 실패시키는 것: `downloadedUpdate` 비교를 지우면 Cancel 뒤의 재시도가 다시 내려받는다.
  it("asks again after Cancel without downloading again", async () => {
    const { download, install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", true)] });
    await installAppUpdate();
    useUIStore.getState().closeUnsavedModal(); // Cancel

    await installAppUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // Cmd+Q reaches the app through the overlay, so a question about quitting can be up when the
  // download ends. Replaced, the Don't Save meant for that quit would install and restart.
  // 이것을 실패시키는 것: `unsavedModal` 검사를 지우면 질문이 바뀐다.
  it("leaves a question already open alone, and asks when pressed again", async () => {
    const { download, install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", true)] });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });

    await installAppUpdate();

    expect(useUIStore.getState().unsavedModal).toEqual({ intent: "quit" });
    expect(install).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().status).toBe("available");

    useUIStore.getState().closeUnsavedModal();
    await installAppUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // The conflict modal paints above this question, but the question would take the focus as it
  // mounts, so Enter on the conflict modal's Reload would save over the external change and install.
  // 이것을 실패시키는 것: `conflictModal` 검사를 지우면 충돌 모달 아래에 질문이 열린다.
  it("does not open beneath the conflict modal, and asks when pressed again", async () => {
    const { download, install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", true)] });
    useUIStore.getState().openConflictModal("/v/a.md", 1, "base");

    await installAppUpdate();

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(install).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().status).toBe("available");

    useUIStore.getState().closeConflictModal();
    await installAppUpdate();

    expect(download).toHaveBeenCalledOnce();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "installUpdate",
    });
  });

  // What holds the install back is unsaved work. With none left, auto-save having caught up while
  // the question was up, nothing is lost by going ahead, and the install was already asked for.
  // 이것을 실패시키는 것: 떠 있는 질문 검사를 `hasUnsavedTabs()` 분기 밖으로 옮기면 설치가 멈춘다.
  it("installs beneath another question when nothing is unsaved", async () => {
    const { install } = await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", false)] });
    useUIStore.setState({ unsavedModal: { intent: "quit" } });

    await installAppUpdate();

    expect(install).toHaveBeenCalledOnce();
  });

  // 이것을 실패시키는 것: `installDownloadedUpdate` 에서 `store.openDialog()` 를 지우면 진행도 실패도 안 보인다.
  it("brings the dialog back if it was closed beneath the question", async () => {
    await findUpdate();
    useEditorStore.setState({ tabs: [fileTab("a", true)] });
    await installAppUpdate();
    useAppUpdateStore.getState().closeDialog();

    await installDownloadedUpdate();

    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);
  });

  // The plugin's `install` empties the Update's package, and a second one throws. Keeping the
  // Update as "downloaded" would then skip the download and send this to the releases page,
  // which only offers the version already installed.
  // 이것을 실패시키는 것: `downloadedUpdate = null` 을 지우면 install 이 던져 releases 페이지가 열린다.
  it("downloads again after a good install whose relaunch failed", async () => {
    const { download, install } = await findUpdate();
    let packageHeld = false;
    download.mockImplementation(async () => {
      packageHeld = true;
    });
    install.mockImplementation(async () => {
      if (!packageHeld)
        throw new Error("Update.install called before download");
      packageHeld = false;
    });
    relaunchMock.mockRejectedValueOnce(new Error("relaunch refused"));
    await installAppUpdate();
    expect(useAppUpdateStore.getState().status).toBe("installed");

    await installAppUpdate();

    expect(download).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenCalledTimes(2);
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("a failed download asks nothing and falls back to the releases page", async () => {
    const { download, install } = await findUpdate();
    download.mockRejectedValue(new Error("network down"));
    useEditorStore.setState({ tabs: [fileTab("a", true)] });

    await installAppUpdate();

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(install).not.toHaveBeenCalled();
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/sayinel/baram/releases/latest",
    );
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.fallbackOpened).toBe(true);
  });

  // 이것을 실패시키는 것: `installDownloadedUpdate` 의 catch 에서 releases 안내를 빼면 길이 끊긴다.
  it("a failed install after the answer falls back, and a retry downloads again", async () => {
    const { download, install } = await findUpdate();
    install.mockRejectedValueOnce(new Error("bundle replace failed"));
    useEditorStore.setState({ tabs: [fileTab("a", true)] });
    await installAppUpdate();

    await installDownloadedUpdate();

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/sayinel/baram/releases/latest",
    );
    expect(useAppUpdateStore.getState().status).toBe("error");

    useEditorStore.setState({ tabs: [fileTab("a", false)] });
    await installAppUpdate();

    expect(download).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenCalledTimes(2);
    expect(relaunchMock).toHaveBeenCalledOnce();
  });
});

describe("periodic checker gating", () => {
  it("runPeriodicCheck does nothing when autoCheckUpdates is off", () => {
    useSettingsStore.setState({ autoCheckUpdates: false });
    runPeriodicCheck();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("runPeriodicCheck runs the check when autoCheckUpdates is on", async () => {
    checkMock.mockResolvedValue(null);
    useSettingsStore.setState({ autoCheckUpdates: true });
    runPeriodicCheck();
    // checkForAppUpdate is fire-and-forget from the interval callback
    await Promise.resolve();
    await Promise.resolve();
    expect(checkMock).toHaveBeenCalledOnce();
  });

  // §206 A check sets the status to `checking` and replaces the update. Up to date, it would
  // also close the dialog and leave the question to install what it has just withdrawn.
  // 이것을 실패시키는 것: `runPeriodicCheck` 의 두 줄을 지우면 설치 도중에 check 가 돈다.
  it.each(["downloading", "installing"] as const)(
    "runPeriodicCheck does nothing while the update is %s",
    (status) => {
      useAppUpdateStore.setState({ status });

      runPeriodicCheck();

      expect(checkMock).not.toHaveBeenCalled();
    },
  );

  it("runPeriodicCheck does nothing while the install question is up", () => {
    useAppUpdateStore.setState({ status: "available" });
    useUIStore.setState({ unsavedModal: { intent: "installUpdate" } });

    runPeriodicCheck();

    expect(checkMock).not.toHaveBeenCalled();
  });

  it("runPeriodicCheck still runs beneath a question about something else", async () => {
    checkMock.mockResolvedValue(null);
    useUIStore.setState({ unsavedModal: { intent: "quit" } });

    runPeriodicCheck();

    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledOnce());
  });

  it("startAppUpdateChecker never schedules a check in DEV (Vitest default)", () => {
    vi.useFakeTimers();
    try {
      startAppUpdateChecker();
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 20_000);
      expect(checkMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
