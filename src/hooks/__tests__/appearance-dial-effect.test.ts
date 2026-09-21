import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useAppearanceDials } from "../use-appearance-dials";

describe("useAppearanceDials", () => {
  beforeEach(() => {
    useSettingsStore.setState({ appearanceOverrides: {} });
    document.documentElement.removeAttribute("style");
  });

  it("writes nothing while every dial is at its default", () => {
    renderHook(() => useAppearanceDials());
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("writes the width variable once the user sets it", () => {
    const { rerender } = renderHook(() => useAppearanceDials());
    act(() => {
      useSettingsStore.getState().setDial("editorMaxWidth", 640);
    });
    rerender();
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("640px");
  });

  it("removes the variable again on reset", () => {
    const { rerender } = renderHook(() => useAppearanceDials());
    act(() => {
      useSettingsStore.getState().setDial("editorMaxWidth", 640);
    });
    rerender();
    act(() => {
      useSettingsStore.getState().resetDial("editorMaxWidth");
    });
    rerender();
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("");
  });
});
