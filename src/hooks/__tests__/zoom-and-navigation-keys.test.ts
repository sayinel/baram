// §4.2 zoom × §37 back/forward — one chord, one action. The design gives the
// same physical chord to different actions per platform (part4 and part9
// shortcut tables): macOS zooms in/out on ⌘= ⌘- and goes back/forward on ⌃- /
// ⌃⇧-; Windows/Linux zoom on Ctrl+= Ctrl+- and go back/forward on Alt+←/→.
// Reset (⌘0 / Ctrl+0) is use-zoom.ts's too — part4's menu tree lists it as
// Actual Size ⌘0.
// Both hooks listen on window — use-zoom.ts in the capture phase, without
// stopping propagation, and use-global-keyboard.ts in the bubble phase — so
// each has to decide by platform on its own, or Ctrl+- does both. They are
// mounted together here because the defect is only visible with both present.

import type { Mock } from "vitest";

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useGlobalKeyboard } from "../use-global-keyboard";
import { useZoom } from "../use-zoom";

const realPlatform = navigator.platform;
const initialZoom = useSettingsStore.getState().zoomLevel;

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

const zoom = () => useSettingsStore.getState().zoomLevel;

let handleGoBack: Mock<() => void>;
let handleGoForward: Mock<() => void>;
let target: HTMLElement;

beforeEach(() => {
  useSettingsStore.setState({ zoomLevel: 1 });
  handleGoBack = vi.fn();
  handleGoForward = vi.fn();
  renderHook(() => useZoom(null));
  renderHook(() =>
    useGlobalKeyboard({
      editor: null,
      findReplaceOpen: false,
      handleGoBack,
      handleGoForward,
      isSourceMode: false,
      setTabSwitcherIndex: vi.fn(),
      setTabSwitcherOpen: vi.fn(),
      tabSwitcherMruRef: { current: [] },
      tabSwitcherOpen: false,
    }),
  );
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
  setPlatform(realPlatform);
  useSettingsStore.setState({ zoomLevel: initialZoom });
});

const minus = { code: "Minus", key: "-" };
const shiftMinus = { code: "Minus", key: "_", shiftKey: true };
const equal = { code: "Equal", key: "=" };
const zero = { code: "Digit0", key: "0" };

describe("macOS — ⌘ zooms, ⌃ navigates", () => {
  beforeEach(() => setPlatform("MacIntel"));

  it("⌃- goes back and does not zoom", () => {
    const e = press({ ...minus, ctrlKey: true });
    expect(handleGoBack).toHaveBeenCalledTimes(1);
    expect(zoom()).toBe(1);
    expect(e.defaultPrevented).toBe(true);
  });

  // "-" as well as "_": on a layout where Shift+- still yields "-", the old
  // use-zoom.ts took it as Zoom Out, so only that case can catch a regression.
  it.each(["_", "-"])("⌃⇧- (key %s) goes forward and does not zoom", (key) => {
    press({ code: "Minus", ctrlKey: true, key, shiftKey: true });
    expect(handleGoForward).toHaveBeenCalledTimes(1);
    expect(zoom()).toBe(1);
  });

  it("⌘- zooms out and does not navigate", () => {
    const e = press({ ...minus, metaKey: true });
    expect(zoom()).toBeCloseTo(0.9);
    expect(handleGoBack).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("⌘= zooms in and ⌘0 resets", () => {
    press({ ...equal, metaKey: true });
    expect(zoom()).toBeCloseTo(1.1);
    press({ ...zero, metaKey: true });
    expect(zoom()).toBe(1);
  });

  it("⌃= and ⌃0 are not zoom", () => {
    useSettingsStore.setState({ zoomLevel: 1.2 });
    const zoomIn = press({ ...equal, ctrlKey: true });
    const reset = press({ ...zero, ctrlKey: true });
    expect(zoom()).toBe(1.2);
    expect([zoomIn.defaultPrevented, reset.defaultPrevented]).toEqual([
      false,
      false,
    ]);
  });
});

describe.each(["Win32", "Linux x86_64"])(
  "%s — Ctrl zooms, Alt+←/→ navigates",
  (platform) => {
    beforeEach(() => setPlatform(platform));

    it("Ctrl+- zooms out and does not go back", () => {
      const e = press({ ...minus, ctrlKey: true });
      expect(zoom()).toBeCloseTo(0.9);
      expect(handleGoBack).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    });

    it("Ctrl+Shift+- does not go forward — Alt+→ does, and Alt+← goes back", () => {
      press({ ...shiftMinus, ctrlKey: true });
      expect(handleGoForward).not.toHaveBeenCalled();
      press({ altKey: true, code: "ArrowRight", key: "ArrowRight" });
      press({ altKey: true, code: "ArrowLeft", key: "ArrowLeft" });
      expect(handleGoForward).toHaveBeenCalledTimes(1);
      expect(handleGoBack).toHaveBeenCalledTimes(1);
    });

    it("Ctrl+= zooms in and Ctrl+0 resets", () => {
      press({ ...equal, ctrlKey: true });
      expect(zoom()).toBeCloseTo(1.1);
      press({ ...zero, ctrlKey: true });
      expect(zoom()).toBe(1);
    });

    it("the Meta key is not the zoom modifier", () => {
      const e = press({ ...minus, metaKey: true });
      expect(zoom()).toBe(1);
      expect(e.defaultPrevented).toBe(false);
    });
  },
);
