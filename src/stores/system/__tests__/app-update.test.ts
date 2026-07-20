import { beforeEach, describe, expect, it } from "vitest";

import { useAppUpdateStore } from "../app-update";

const RESET = {
  status: "idle" as const,
  availableVersion: null,
  notes: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  dialogOpen: false,
  fallbackOpened: false,
};

describe("useAppUpdateStore", () => {
  beforeEach(() => {
    useAppUpdateStore.setState(RESET);
  });

  it("idle -> checking -> available", () => {
    useAppUpdateStore.getState().setChecking();
    expect(useAppUpdateStore.getState().status).toBe("checking");

    useAppUpdateStore.getState().setAvailable("0.4.0", "Release notes");
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.availableVersion).toBe("0.4.0");
    expect(s.notes).toBe("Release notes");
    expect(s.lastCheckedAt).not.toBeNull();
  });

  it("idle -> checking -> upToDate", () => {
    useAppUpdateStore.getState().setChecking();
    useAppUpdateStore.getState().setUpToDate();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("upToDate");
    expect(s.lastCheckedAt).not.toBeNull();
  });

  it("idle -> checking -> error, with default fallbackOpened false", () => {
    useAppUpdateStore.getState().setChecking();
    useAppUpdateStore.getState().setError("network failed");
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("network failed");
    expect(s.fallbackOpened).toBe(false);
  });

  it("setError can flag a releases-page fallback", () => {
    useAppUpdateStore.getState().setError("install unsupported", true);
    expect(useAppUpdateStore.getState().fallbackOpened).toBe(true);
  });

  it("setChecking clears a previous error and fallbackOpened", () => {
    useAppUpdateStore.getState().setError("boom", true);
    useAppUpdateStore.getState().setChecking();
    const s = useAppUpdateStore.getState();
    expect(s.error).toBeNull();
    expect(s.fallbackOpened).toBe(false);
  });

  it("downloading -> progress updates -> installing", () => {
    useAppUpdateStore.getState().setDownloading();
    expect(useAppUpdateStore.getState().status).toBe("downloading");
    expect(useAppUpdateStore.getState().progress).toBeNull();

    useAppUpdateStore.getState().setProgress({ downloaded: 0, total: 1000 });
    useAppUpdateStore.getState().setProgress({ downloaded: 500, total: 1000 });
    expect(useAppUpdateStore.getState().progress).toEqual({
      downloaded: 500,
      total: 1000,
    });

    useAppUpdateStore.getState().setInstalling();
    expect(useAppUpdateStore.getState().status).toBe("installing");
  });

  it("openDialog / closeDialog toggle dialogOpen", () => {
    useAppUpdateStore.getState().openDialog();
    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);
    useAppUpdateStore.getState().closeDialog();
    expect(useAppUpdateStore.getState().dialogOpen).toBe(false);
  });

  // §206-review FIX 3: a later "no update" result must not leave a stale
  // "available vX" dialog open with a no-op Install button.
  it("setUpToDate clears availableVersion/notes and closes an open dialog", () => {
    useAppUpdateStore.getState().setAvailable("0.5.0", "Some notes");
    useAppUpdateStore.getState().openDialog();
    expect(useAppUpdateStore.getState().dialogOpen).toBe(true);

    useAppUpdateStore.getState().setUpToDate();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe("upToDate");
    expect(s.availableVersion).toBeNull();
    expect(s.notes).toBeNull();
    expect(s.dialogOpen).toBe(false);
  });
});
