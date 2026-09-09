// issue 598 — the refusal to move a space onto another context's directory
// reaches the user as a toast, phrased where a locale is at hand.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stores/system/tauri-storage", () => ({
  tauriStorage: {
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => undefined),
    setItem: vi.fn(async () => undefined),
  },
}));
vi.mock("../vault-context-loader", () => ({
  switchContext: vi.fn(async () => undefined),
}));

import type { ContextInfo } from "../../ipc/types";

import { SpaceDirectoryTakenError } from "../../stores/context/errors";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { reportSpaceDirectoryTaken } from "../space-context-migration";

const NOTES: ContextInfo = {
  addedAt: 0,
  color: "#fff",
  contextType: "vault",
  id: "plain",
  label: "Notes",
  path: "/vault/notes",
};

describe("reportSpaceDirectoryTaken", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: "en" } as never);
  });

  it("names the directory and the context that holds it, per space", () => {
    const toast = vi.spyOn(useUIStore.getState(), "showToast");
    const err = new SpaceDirectoryTakenError("journal", "/vault/notes", NOTES);

    expect(reportSpaceDirectoryTaken(err)).toBe(true);

    expect(toast).toHaveBeenCalledTimes(1);
    const [message, kind] = toast.mock.calls[0]!;
    expect(kind).toBe("error");
    expect(message).toContain("/vault/notes");
    expect(message).toContain("Notes");
    expect(message).toMatch(/Journal/);
    // No raw key leaked through.
    expect(message).not.toContain("space.journal");
  });

  it("speaks the current locale", () => {
    useSettingsStore.setState({ locale: "ko" } as never);
    const toast = vi.spyOn(useUIStore.getState(), "showToast");

    reportSpaceDirectoryTaken(
      new SpaceDirectoryTakenError("zettelkasten", "/vault/notes", NOTES),
    );

    expect(toast.mock.calls.at(-1)![0]).toMatch(/[가-힣]/);
  });

  it("leaves every other error to the caller", () => {
    const toast = vi.spyOn(useUIStore.getState(), "showToast");
    toast.mockClear();

    expect(reportSpaceDirectoryTaken(new Error("Access denied"))).toBe(false);
    expect(reportSpaceDirectoryTaken("VAULT_APPROVAL_DENIED")).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
