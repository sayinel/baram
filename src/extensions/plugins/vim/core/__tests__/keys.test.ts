// §298 Vim Phase 1 — keystroke normalization (design §5 modifier pin).
//
// The pin these tests hold: on macOS, Mod is Command and the PHYSICAL Control
// key remains a separate vim modifier — reading Ctrl+C as a clipboard chord
// there would steal <C-…> vim chords. Elsewhere Control plays both parts.

import { afterEach, describe, expect, it, vi } from "vitest";

import { isMacPlatform, toKeyToken } from "../keys";

const base = {
  altKey: false,
  ctrlKey: false,
  key: "",
  metaKey: false,
  shiftKey: false,
};

describe("isMacPlatform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows navigator.platform", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isMacPlatform()).toBe(true);
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(isMacPlatform()).toBe(false);
  });

  it("is false when navigator does not exist (SSR-style)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isMacPlatform()).toBe(false);
  });
});

describe("toKeyToken (§5 modifier pin)", () => {
  it("macOS: Cmd+C is a Mod chord, not a ctrl one", () => {
    const token = toKeyToken({ ...base, key: "c", metaKey: true }, true);
    expect(token).toEqual({
      alt: false,
      ctrl: false,
      key: "c",
      mod: true,
      shift: false,
    });
  });

  it("macOS: physical Ctrl stays a vim modifier, never Mod", () => {
    const token = toKeyToken({ ...base, ctrlKey: true, key: "r" }, true);
    expect(token.ctrl).toBe(true);
    expect(token.mod).toBe(false); // <C-r> must not read as a Mod chord
  });

  it("non-mac: Control plays both parts — ctrl AND mod", () => {
    const token = toKeyToken({ ...base, ctrlKey: true, key: "c" }, false);
    expect(token.ctrl).toBe(true);
    expect(token.mod).toBe(true);
  });

  it("non-mac: meta alone is neither ctrl nor mod", () => {
    const token = toKeyToken({ ...base, key: "c", metaKey: true }, false);
    expect(token.mod).toBe(false);
    expect(token.ctrl).toBe(false);
  });

  it("carries alt/shift and the raw key through untouched", () => {
    const token = toKeyToken(
      { ...base, altKey: true, key: "Escape", shiftKey: true },
      true,
    );
    expect(token).toEqual({
      alt: true,
      ctrl: false,
      key: "Escape",
      mod: false,
      shift: true,
    });
  });
});
