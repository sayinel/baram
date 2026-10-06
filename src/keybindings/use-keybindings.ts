/**
 * useKeybindings — merge layer between registry defaults and user overrides.
 * §settings: keybinding customization support
 *
 * §391 spec 0070 §8 — plugin commands join as an ARGUMENT (`pluginEntries`), never read from a
 * store here, so the three functions below stay pure. Callers that pass none see the registry
 * alone, as before.
 */

import { useMemo } from "react";

import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../plugins/plugin-ui-store";
import { useSettingsStore } from "../stores/settings/store";
import {
  KEYBINDING_REGISTRY,
  type KeybindingEntry,
} from "./keybinding-registry";
import {
  isPluginKeybindingId,
  parsePluginKeybindingId,
  pluginKeybindingEntries,
} from "./plugin-keybindings";

/**
 * §391 spec 0070 §8 — what a key is already taken by: an entry of the merged list, or the stored
 * key of a plugin command that is not in the list now (its plugin is off or removed, or a new
 * version dropped the command).
 */
export type KeybindingConflict =
  | { commandId: string; kind: "absent"; pluginId: string }
  | { entry: MergedKeybinding; kind: "entry" };

export interface MergedKeybinding extends KeybindingEntry {
  activeKey: string; // override value if exists, else defaultKey
  isOverridden: boolean; // true if user has overridden this key
}

/** The override a confirmed swap removes. */
export function conflictCommandId(conflict: KeybindingConflict): string {
  return conflict.kind === "entry" ? conflict.entry.id : conflict.commandId;
}

/**
 * Pure function — finds the customizable command bound to the given key notation.
 * Only searches customizable entries; returns the first match or undefined. The registry comes
 * before `pluginEntries`, so a core command wins a key it shares with a plugin command.
 */
export function findCommandByKey(
  keyNotation: string,
  overrides: Record<string, string>,
  pluginEntries: readonly KeybindingEntry[] = [],
): MergedKeybinding | undefined {
  return getMergedKeybindings(overrides, pluginEntries).find(
    (entry) => entry.customizable && entry.activeKey === keyNotation,
  );
}

/**
 * Pure function — what assigning `newKey` to `commandId` would collide with, or null.
 * Self-assignment is not a conflict. Only the first counterpart is reported.
 *
 * The merged list comes first, then the stored keys of plugin commands that are not in it — so
 * a plugin target that collides with both a core command and a stored key is refused (§391
 * spec 0070 §8). A core target skips Tiptap's fixed keys (`customizable: false`) as before; a
 * plugin target does not (D13 — `Mod+B` given to a plugin would run alongside Bold).
 */
export function findConflict(
  commandId: string,
  newKey: string,
  overrides: Record<string, string>,
  pluginEntries: readonly KeybindingEntry[] = [],
): KeybindingConflict | null {
  const forPlugin = isPluginKeybindingId(commandId);
  const merged = getMergedKeybindings(overrides, pluginEntries);
  for (const entry of merged) {
    if (!entry.customizable && !forPlugin) continue;
    if (entry.id === commandId) continue;
    if (entry.activeKey === newKey) return { entry, kind: "entry" };
  }
  const listed = new Set(merged.map((entry) => entry.id));
  for (const [id, key] of Object.entries(overrides)) {
    if (key !== newKey || id === commandId || listed.has(id)) continue;
    // A key of another shape is a hand-edited setting, not a plugin command's: ignored.
    const stored = parsePluginKeybindingId(id);
    if (stored) {
      return { commandId: id, kind: "absent", pluginId: stored.pluginId };
    }
  }
  return null;
}

/**
 * Pure function — maps KEYBINDING_REGISTRY entries, then `pluginEntries`, applying overrides
 * where allowed.
 */
export function getMergedKeybindings(
  overrides: Record<string, string>,
  pluginEntries: readonly KeybindingEntry[] = [],
): MergedKeybinding[] {
  return [...KEYBINDING_REGISTRY, ...pluginEntries].map((entry) => {
    const hasOverride = entry.customizable && overrides[entry.id] !== undefined;
    return {
      ...entry,
      activeKey: hasOverride ? overrides[entry.id] : entry.defaultKey,
      isOverridden: hasOverride,
    };
  });
}

/**
 * D13 — a plugin command may not take a key a core command uses (Tiptap's included): the note
 * shows, and confirming assigns nothing. Swapping is plugin ↔ plugin only.
 */
export function isRefusedConflict(
  commandId: string,
  conflict: KeybindingConflict | null,
): boolean {
  return (
    isPluginKeybindingId(commandId) &&
    conflict?.kind === "entry" &&
    !isPluginKeybindingId(conflict.entry.id)
  );
}

/**
 * React hook — returns merged keybindings, reactively updated when overrides change, and — §391
 * — when a plugin's contributions go up or down.
 */
export function useKeybindings(): MergedKeybinding[] {
  const overrides = useSettingsStore((s) => s.keybindingOverrides);
  const contributions = usePluginUIStore(useShallow((s) => s.contributions));

  return useMemo(
    () =>
      getMergedKeybindings(overrides, pluginKeybindingEntries(contributions)),
    [overrides, contributions],
  );
}
