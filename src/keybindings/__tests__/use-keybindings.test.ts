/**
 * Tests for pure functions in use-keybindings.ts
 * §settings: keybinding customization support
 */

import { describe, it, expect } from "vitest";
import {
  getMergedKeybindings,
  findCommandByKey,
  findConflict,
} from "../use-keybindings";
import { KEYBINDING_REGISTRY } from "../keybinding-registry";

// Pick known stable IDs from the registry for tests
const CUSTOMIZABLE_ID = "file.save";       // defaultKey: "Mod+S", customizable: true
const CUSTOMIZABLE_ID2 = "file.new";       // defaultKey: "Mod+N", customizable: true
const NON_CUSTOMIZABLE_ID = "formatting.bold"; // defaultKey: "Mod+B", customizable: false

describe("getMergedKeybindings", () => {
  it("returns default key when no override exists", () => {
    const merged = getMergedKeybindings({});
    const entry = merged.find((e) => e.id === CUSTOMIZABLE_ID)!;
    expect(entry).toBeDefined();
    expect(entry.activeKey).toBe(entry.defaultKey);
    expect(entry.isOverridden).toBe(false);
  });

  it("applies override for a customizable entry", () => {
    const merged = getMergedKeybindings({ [CUSTOMIZABLE_ID]: "Mod+Shift+S" });
    const entry = merged.find((e) => e.id === CUSTOMIZABLE_ID)!;
    expect(entry.activeKey).toBe("Mod+Shift+S");
    expect(entry.isOverridden).toBe(true);
  });

  it("ignores override for a non-customizable entry", () => {
    const merged = getMergedKeybindings({ [NON_CUSTOMIZABLE_ID]: "Mod+Shift+B" });
    const entry = merged.find((e) => e.id === NON_CUSTOMIZABLE_ID)!;
    expect(entry.activeKey).toBe(entry.defaultKey);
    expect(entry.isOverridden).toBe(false);
  });

  it("returns an entry for every registry item", () => {
    const merged = getMergedKeybindings({});
    expect(merged.length).toBe(KEYBINDING_REGISTRY.length);
  });
});

describe("findCommandByKey", () => {
  it("finds a command by its default key", () => {
    const result = findCommandByKey("Mod+S", {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(CUSTOMIZABLE_ID);
  });

  it("finds a command by its overridden key", () => {
    const result = findCommandByKey("Mod+Alt+S", { [CUSTOMIZABLE_ID]: "Mod+Alt+S" });
    expect(result).toBeDefined();
    expect(result!.id).toBe(CUSTOMIZABLE_ID);
  });

  it("returns undefined for a key not bound to any command", () => {
    const result = findCommandByKey("Mod+F24", {});
    expect(result).toBeUndefined();
  });

  it("does not match non-customizable entries by key", () => {
    // Mod+B is the default for formatting.bold (non-customizable)
    // It should not be returned by findCommandByKey since it only searches customizable entries
    const result = findCommandByKey("Mod+B", {});
    expect(result).toBeUndefined();
  });
});

describe("findConflict", () => {
  it("detects a conflict when another command uses the same key", () => {
    // Assign file.save's default key "Mod+S" to file.new — conflict with file.save
    const conflict = findConflict(CUSTOMIZABLE_ID2, "Mod+S", {});
    expect(conflict).not.toBeNull();
    expect(conflict!.id).toBe(CUSTOMIZABLE_ID);
  });

  it("returns null when the key is unique (no conflict)", () => {
    const conflict = findConflict(CUSTOMIZABLE_ID, "Mod+F24", {});
    expect(conflict).toBeNull();
  });

  it("does not treat self-assignment as a conflict", () => {
    // Assigning file.save's own default key back to itself is not a conflict
    const conflict = findConflict(CUSTOMIZABLE_ID, "Mod+S", {});
    expect(conflict).toBeNull();
  });

  it("detects a conflict after an override is applied", () => {
    // Override file.new to "Mod+Z", then try to assign "Mod+Z" to file.save
    const conflict = findConflict(CUSTOMIZABLE_ID, "Mod+Z", { [CUSTOMIZABLE_ID2]: "Mod+Z" });
    expect(conflict).not.toBeNull();
    expect(conflict!.id).toBe(CUSTOMIZABLE_ID2);
  });
});
