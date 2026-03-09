/**
 * useKeybindings — merge layer between registry defaults and user overrides.
 * §settings: keybinding customization support
 */

import { useMemo } from "react";
import {
  KEYBINDING_REGISTRY,
  type KeybindingEntry,
} from "./keybinding-registry";
import { useSettingsStore } from "../stores/settings-store";

export interface MergedKeybinding extends KeybindingEntry {
  activeKey: string; // override value if exists, else defaultKey
  isOverridden: boolean; // true if user has overridden this key
}

/**
 * Pure function — maps KEYBINDING_REGISTRY entries, applying overrides where allowed.
 */
export function getMergedKeybindings(
  overrides: Record<string, string>,
): MergedKeybinding[] {
  return KEYBINDING_REGISTRY.map((entry) => {
    const hasOverride = entry.customizable && overrides[entry.id] !== undefined;
    return {
      ...entry,
      activeKey: hasOverride ? overrides[entry.id] : entry.defaultKey,
      isOverridden: hasOverride,
    };
  });
}

/**
 * Pure function — finds the customizable command bound to the given key notation.
 * Only searches customizable entries; returns the first match or undefined.
 */
export function findCommandByKey(
  keyNotation: string,
  overrides: Record<string, string>,
): MergedKeybinding | undefined {
  return getMergedKeybindings(overrides).find(
    (entry) => entry.customizable && entry.activeKey === keyNotation,
  );
}

/**
 * Pure function — checks if assigning newKey to commandId would conflict with
 * another customizable binding. Self-assignment is not a conflict.
 * Returns the conflicting entry or null.
 */
export function findConflict(
  commandId: string,
  newKey: string,
  overrides: Record<string, string>,
): MergedKeybinding | null {
  const merged = getMergedKeybindings(overrides);
  for (const entry of merged) {
    if (!entry.customizable) continue;
    if (entry.id === commandId) continue;
    if (entry.activeKey === newKey) return entry;
  }
  return null;
}

/**
 * React hook — returns merged keybindings, reactively updated when overrides change.
 */
export function useKeybindings(): MergedKeybinding[] {
  // keybindingOverrides will be added to settings-store in Task 4.
  // Fall back to empty object if the field doesn't exist yet.
  const overrides = (
    useSettingsStore as (
      selector: (s: Record<string, unknown>) => unknown,
    ) => unknown
  )(
    (s: Record<string, unknown>) =>
      (s["keybindingOverrides"] as Record<string, string> | undefined) ?? {},
  ) as Record<string, string>;

  return useMemo(() => getMergedKeybindings(overrides), [overrides]);
}
