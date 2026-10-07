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
vi.mock("../../stores/ai/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../stores/ai/chat")>()),
  flushChatPersist: flushChatPersistMock,
}));

import { useSettingsStore } from "../../stores/settings/store";
import { useAppUpdateStore } from "../../stores/system/app-update";
import { useUIStore } from "../../stores/ui/ui";
import {
  checkForAppUpdate,
  installAppUpdate,
  runPeriodicCheck,
  startAppUpdateChecker,
  stopAppUpdateChecker,
} from "../app-update";

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
  useUIStore.setState({ toast: null });
  useSettingsStore.setState({ autoCheckUpdates: true });
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
      downloadAndInstall: vi.fn(),
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
      downloadAndInstall: vi.fn(),
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
    const downloadAndInstall = vi.fn().mockImplementation(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      downloadAndInstall,
    });
    await checkForAppUpdate(true);

    setPlatform("MacIntel");
    await installAppUpdate();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
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
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    });
    await checkForAppUpdate(true);
    flushChatPersistMock.mockClear();

    await installAppUpdate();

    expect(flushChatPersistMock).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(flushChatPersistMock.mock.invocationCallOrder[0]).toBeLessThan(
      relaunchMock.mock.invocationCallOrder[0],
    );
  });

  // §44 A failure after the install is not an install failure: the releases page would only
  // offer the version that is already installed (#800).
  // 이것을 실패시키는 것: app-update.ts 에서 relaunchApp() 을 설치와 같은 try 로 되돌리면 재시작 실패가 설치
  // 실패로 보고되고 releases 페이지가 열린다.
  it("a failed relaunch after a good install asks for a manual restart", async () => {
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
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
    const downloadAndInstall = vi
      .fn()
      .mockRejectedValue(new Error("bundle replace failed"));
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      downloadAndInstall,
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
    const downloadAndInstall = vi.fn().mockImplementation(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      downloadAndInstall,
    });
    await checkForAppUpdate(true);

    setPlatform("Win32");
    await installAppUpdate();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().progress).toEqual({
      downloaded: 100,
      total: 100,
    });
  });

  it("Linux install failure (e.g. deb/rpm) falls back to the releases page", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockRejectedValue(new Error("unsupported package format"));
    checkMock.mockResolvedValue({
      version: "0.4.0",
      body: null,
      downloadAndInstall,
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
