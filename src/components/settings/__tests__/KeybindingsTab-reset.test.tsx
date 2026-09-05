// issue 523 — "Reset All" asks through the app's own confirm dialog.
//
// It used the webview's native confirm(), while every other destructive
// question in the app goes through showConfirm (utils/confirm-dialog.ts). One
// dialog, one look — and the confirm button says what it does ("Reset All"),
// because the helper's default label is "Delete".
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => false),
}));

import { useSettingsStore } from "../../../stores/settings/store";
import { showConfirm } from "../../../utils/confirm-dialog";
import { KeybindingsTab } from "../tabs/KeybindingsTab";

const OVERRIDES = { "format.bold": "Mod-Alt-b" };

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(showConfirm).mockReset();
  vi.mocked(showConfirm).mockResolvedValue(false);
  useSettingsStore.setState({ keybindingOverrides: OVERRIDES, locale: "en" });
});

afterEach(() => {
  useSettingsStore.setState({ keybindingOverrides: {} });
});

describe("Reset All", () => {
  it("asks through showConfirm with a label that says what it does", async () => {
    const native = vi.spyOn(window, "confirm");
    render(<KeybindingsTab />);

    fireEvent.click(screen.getByText("Reset All"));
    await settle();

    expect(native).not.toHaveBeenCalled();
    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(showConfirm).mock.calls[0];
    expect(message).toBe("Reset all keybindings to defaults?");
    expect(options?.confirmLabel).toBe("Reset All");
    expect(options?.cancelLabel).toBe("Cancel");
    expect(useSettingsStore.getState().keybindingOverrides).toEqual(OVERRIDES);
    native.mockRestore();
  });

  it("resets only when the answer is yes", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    render(<KeybindingsTab />);

    fireEvent.click(screen.getByText("Reset All"));
    await settle();

    expect(useSettingsStore.getState().keybindingOverrides).toEqual({});
  });
});

describe("Reset All while a key capture is pending", () => {
  // The capture listener owns every keydown on window in the capture phase
  // (preventDefault + stopPropagation); left running, it would swallow the
  // dialog's Enter and Escape. Reset All ends it before asking.
  it("ends the capture before opening the dialog", async () => {
    render(<KeybindingsTab />);
    const editButton = [
      ...document.querySelectorAll<HTMLElement>(".keybinding-actions button"),
    ].find((b) => !b.classList.contains("keybinding-reset-btn"));
    if (!editButton) throw new Error("no edit button to start a capture");
    fireEvent.click(editButton);
    expect(document.querySelector(".keybinding-capture")).not.toBeNull();

    fireEvent.click(screen.getByText("Reset All"));
    await settle();

    expect(document.querySelector(".keybinding-capture")).toBeNull();
    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
  });
});
