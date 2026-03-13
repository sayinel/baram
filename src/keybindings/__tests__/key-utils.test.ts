import { describe, expect, it } from "vitest";

import {
  formatKeyForDisplay,
  keysMatch,
  normalizeKeyEvent,
  type ParsedKey,
  parseKeyNotation,
} from "../key-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    code: "",
    key: "",
    ...overrides,
  } as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// normalizeKeyEvent
// ---------------------------------------------------------------------------

describe("normalizeKeyEvent", () => {
  it("Cmd+S on macOS → Mod+S", () => {
    const e = makeKeyEvent({ metaKey: true, code: "KeyS", key: "s" });
    expect(normalizeKeyEvent(e, true)).toBe("Mod+S");
  });

  it("Ctrl+Shift+F on non-macOS → Mod+Shift+F", () => {
    const e = makeKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      code: "KeyF",
      key: "f",
    });
    expect(normalizeKeyEvent(e, false)).toBe("Mod+Shift+F");
  });

  it("Alt+Mod+1 on macOS → Mod+Alt+1", () => {
    const e = makeKeyEvent({
      metaKey: true,
      altKey: true,
      code: "Digit1",
      key: "1",
    });
    expect(normalizeKeyEvent(e, true)).toBe("Mod+Alt+1");
  });

  it("standalone Escape → Escape", () => {
    const e = makeKeyEvent({ code: "Escape", key: "Escape" });
    expect(normalizeKeyEvent(e, true)).toBe("Escape");
    expect(normalizeKeyEvent(e, false)).toBe("Escape");
  });

  it("Shift+Enter → Shift+Enter", () => {
    const e = makeKeyEvent({ shiftKey: true, code: "Enter", key: "Enter" });
    expect(normalizeKeyEvent(e, false)).toBe("Shift+Enter");
  });

  it("bare MetaLeft returns empty string", () => {
    const e = makeKeyEvent({ metaKey: true, code: "MetaLeft", key: "Meta" });
    expect(normalizeKeyEvent(e, true)).toBe("");
  });

  it("bare ControlLeft returns empty string", () => {
    const e = makeKeyEvent({
      ctrlKey: true,
      code: "ControlLeft",
      key: "Control",
    });
    expect(normalizeKeyEvent(e, false)).toBe("");
  });

  it("bare ShiftLeft returns empty string", () => {
    const e = makeKeyEvent({ shiftKey: true, code: "ShiftLeft", key: "Shift" });
    expect(normalizeKeyEvent(e, false)).toBe("");
  });

  it("Ctrl+S on macOS (not Mod) → S only (no Mod)", () => {
    // ctrlKey is not metaKey on macOS — should not produce Mod
    const e = makeKeyEvent({ ctrlKey: true, code: "KeyS", key: "s" });
    expect(normalizeKeyEvent(e, true)).toBe("S");
  });

  it("Slash key → /", () => {
    const e = makeKeyEvent({ code: "Slash", key: "/" });
    expect(normalizeKeyEvent(e, false)).toBe("/");
  });

  it("Period key → .", () => {
    const e = makeKeyEvent({ code: "Period", key: "." });
    expect(normalizeKeyEvent(e, false)).toBe(".");
  });

  it("Mod+Shift+Alt+K on macOS", () => {
    const e = makeKeyEvent({
      metaKey: true,
      shiftKey: true,
      altKey: true,
      code: "KeyK",
      key: "k",
    });
    expect(normalizeKeyEvent(e, true)).toBe("Mod+Shift+Alt+K");
  });

  it("Ctrl+Shift+F5 on non-macOS → Mod+Shift+F5", () => {
    const e = makeKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      code: "F5",
      key: "F5",
    });
    expect(normalizeKeyEvent(e, false)).toBe("Mod+Shift+F5");
  });

  it("Tab key alone → Tab", () => {
    const e = makeKeyEvent({ code: "Tab", key: "Tab" });
    expect(normalizeKeyEvent(e, false)).toBe("Tab");
  });
});

// ---------------------------------------------------------------------------
// formatKeyForDisplay
// ---------------------------------------------------------------------------

describe("formatKeyForDisplay", () => {
  it("macOS: Mod+Shift+F → ⌘⇧F", () => {
    expect(formatKeyForDisplay("Mod+Shift+F", true)).toBe("⌘⇧F");
  });

  it("macOS: Mod+S → ⌘S", () => {
    expect(formatKeyForDisplay("Mod+S", true)).toBe("⌘S");
  });

  it("macOS: Alt+Z → ⌥Z", () => {
    expect(formatKeyForDisplay("Alt+Z", true)).toBe("⌥Z");
  });

  it("macOS: Mod+Alt+1 → ⌘⌥1", () => {
    expect(formatKeyForDisplay("Mod+Alt+1", true)).toBe("⌘⌥1");
  });

  it("non-macOS: Mod+Shift+F → Ctrl+Shift+F", () => {
    expect(formatKeyForDisplay("Mod+Shift+F", false)).toBe("Ctrl+Shift+F");
  });

  it("non-macOS: Mod+S → Ctrl+S", () => {
    expect(formatKeyForDisplay("Mod+S", false)).toBe("Ctrl+S");
  });

  it("non-macOS: Alt+Z → Alt+Z", () => {
    expect(formatKeyForDisplay("Alt+Z", false)).toBe("Alt+Z");
  });

  it("macOS: Escape → Esc", () => {
    expect(formatKeyForDisplay("Escape", true)).toBe("Esc");
  });

  it("non-macOS: Escape → Esc", () => {
    expect(formatKeyForDisplay("Escape", false)).toBe("Esc");
  });

  it("macOS: Enter → ↩", () => {
    expect(formatKeyForDisplay("Enter", true)).toBe("↩");
  });

  it("non-macOS: Enter → Enter", () => {
    expect(formatKeyForDisplay("Enter", false)).toBe("Enter");
  });

  it("macOS: Tab → ⇥", () => {
    expect(formatKeyForDisplay("Tab", true)).toBe("⇥");
  });

  it("non-macOS: Tab → Tab", () => {
    expect(formatKeyForDisplay("Tab", false)).toBe("Tab");
  });

  it("macOS: Shift+Enter → ⇧↩", () => {
    expect(formatKeyForDisplay("Shift+Enter", true)).toBe("⇧↩");
  });

  it("empty notation → empty string", () => {
    expect(formatKeyForDisplay("", true)).toBe("");
    expect(formatKeyForDisplay("", false)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseKeyNotation
// ---------------------------------------------------------------------------

describe("parseKeyNotation", () => {
  it("Mod+Shift+S → { mod: true, shift: true, alt: false, key: 'S' }", () => {
    const result: ParsedKey = parseKeyNotation("Mod+Shift+S");
    expect(result).toEqual({ mod: true, shift: true, alt: false, key: "S" });
  });

  it("Mod+S → { mod: true, shift: false, alt: false, key: 'S' }", () => {
    expect(parseKeyNotation("Mod+S")).toEqual({
      mod: true,
      shift: false,
      alt: false,
      key: "S",
    });
  });

  it("Escape → { mod: false, shift: false, alt: false, key: 'Escape' }", () => {
    expect(parseKeyNotation("Escape")).toEqual({
      mod: false,
      shift: false,
      alt: false,
      key: "Escape",
    });
  });

  it("Mod+Shift+Alt+K → { mod: true, shift: true, alt: true, key: 'K' }", () => {
    expect(parseKeyNotation("Mod+Shift+Alt+K")).toEqual({
      mod: true,
      shift: true,
      alt: true,
      key: "K",
    });
  });

  it("Alt+1 → { mod: false, shift: false, alt: true, key: '1' }", () => {
    expect(parseKeyNotation("Alt+1")).toEqual({
      mod: false,
      shift: false,
      alt: true,
      key: "1",
    });
  });

  it("Shift+Enter → { mod: false, shift: true, alt: false, key: 'Enter' }", () => {
    expect(parseKeyNotation("Shift+Enter")).toEqual({
      mod: false,
      shift: true,
      alt: false,
      key: "Enter",
    });
  });

  it("/ alone → { mod: false, shift: false, alt: false, key: '/' }", () => {
    expect(parseKeyNotation("/")).toEqual({
      mod: false,
      shift: false,
      alt: false,
      key: "/",
    });
  });
});

// ---------------------------------------------------------------------------
// keysMatch
// ---------------------------------------------------------------------------

describe("keysMatch", () => {
  it("identical notations → true", () => {
    expect(keysMatch("Mod+S", "Mod+S")).toBe(true);
  });

  it("different notations → false", () => {
    expect(keysMatch("Mod+S", "Mod+Shift+S")).toBe(false);
  });

  it("case sensitive → false for different case", () => {
    expect(keysMatch("Mod+S", "Mod+s")).toBe(false);
  });

  it("empty strings equal → true", () => {
    expect(keysMatch("", "")).toBe(true);
  });

  it("one empty one not → false", () => {
    expect(keysMatch("", "Mod+S")).toBe(false);
  });

  it("Escape equals Escape → true", () => {
    expect(keysMatch("Escape", "Escape")).toBe(true);
  });
});
