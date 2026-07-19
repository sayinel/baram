import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.hoisted(() => vi.fn());
const relaunchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const openUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

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
  it("macOS never installs in-place — it only opens the releases page", async () => {
    const downloadAndInstall = vi.fn();
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
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
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
