// §391 spec 0070 §8 — plugin commands in the keybinding list. Not in the static registry: one
// entry per command a plugin with contributions up declares (`palette: false` included), built
// from the store's slice and handed to the pure functions in `use-keybindings.ts` as an
// argument, so they stay pure.
import type { PluginEntryContributions } from "../plugins/plugin-ui-store";
import type { KeybindingEntry } from "./keybinding-registry";
import type { MergedKeybinding } from "./use-keybindings";

import {
  MAX_ENTRY_TITLE_CHARS,
  pluginSourceLabel,
  sanitizePluginText,
} from "../plugins/plugin-text";

/**
 * Registry ids are `<lowercase>.<name>` and hold no `:` (`keybinding-registry.test.ts` pins the
 * shape), so no registry id starts with this.
 */
export const PLUGIN_KEYBINDING_PREFIX = "plugin:";

/** §8 — the two notes a plugin row can carry when its key overlaps another entry's. */
export type PluginOverlap = "both-run" | "shadowed";

/**
 * A stored `plugin:<pluginId>.<commandId>`. The plugin id runs to the FIRST `.` — plugin ids
 * are `^[a-z0-9-]+$`, with no `.` (`manifest.ts`) — and the command id is a contribution id
 * (`CONTRIBUTION_ID`, at most 64 characters). Any other shape is a hand-edited setting.
 */
const STORED_PLUGIN_KEY = /^plugin:([a-z0-9-]+)\.([A-Za-z0-9_-]{1,64})$/;

/** One list per slice object (plan 0118 P9): every change to the slice replaces the object. */
const entriesBySlice = new WeakMap<object, readonly KeybindingEntry[]>();

export function isPluginKeybindingId(id: string): boolean {
  return id.startsWith(PLUGIN_KEYBINDING_PREFIX);
}

/**
 * A row's name: a plugin title as written, a core label through `t()`. The flag is the only
 * way to tell them apart — `t()` translates any string that is a key, so a plugin titled
 * `menu.edit.copy` would be drawn "Copy" (spec 0070 §8).
 */
export function keybindingLabel(
  entry: KeybindingEntry,
  t: (key: string) => string,
): string {
  return entry.literalLabel ? entry.label : t(entry.label);
}

/** A stored key's plugin and command, or `null` for any other shape (spec 0070 §8). */
export function parsePluginKeybindingId(
  id: string,
): null | { commandId: string; pluginId: string } {
  const match = STORED_PLUGIN_KEY.exec(id);
  return match ? { commandId: match[2], pluginId: match[1] } : null;
}

/** `plugin:cite.insert` → `cite.insert`, the id `executePluginCommand` takes. */
export function pluginCommandFullId(keybindingId: string): string {
  return keybindingId.slice(PLUGIN_KEYBINDING_PREFIX.length);
}

/**
 * One entry per declared command: `plugin:<pluginId>.<commandId>`, category `plugins`, no
 * default key, the title as a literal label and the plugin's name — both through the D16
 * sanitiser. Ordered by plugin id, then as declared: a fixed order, because the first of two
 * plugin entries on one key is the one `findCommandByKey` runs (spec §7 · §8).
 */
export function pluginKeybindingEntries(
  contributions: Readonly<Record<string, PluginEntryContributions>>,
): readonly KeybindingEntry[] {
  const cached = entriesBySlice.get(contributions);
  if (cached) return cached;
  const entries: KeybindingEntry[] = [];
  for (const pluginId of Object.keys(contributions).sort()) {
    const entry = contributions[pluginId];
    const pluginName = pluginSourceLabel(entry.name, pluginId);
    for (const command of entry.commands) {
      entries.push({
        category: "plugins",
        customizable: true,
        defaultKey: "",
        id: `${PLUGIN_KEYBINDING_PREFIX}${pluginId}.${command.id}`,
        label: sanitizePluginText(command.title, MAX_ENTRY_TITLE_CHARS),
        literalLabel: true,
        pluginName,
      });
    }
  }
  entriesBySlice.set(contributions, entries);
  return entries;
}

/**
 * §8 — the note a PLUGIN row carries when its key is also another entry's. `shadowed`: an
 * earlier customizable entry has it — a core command, or a plugin with a lower id — and
 * `findCommandByKey` runs that one. `both-run`: no such entry, but a Tiptap key
 * (`customizable: false`) is the same — its keymap and the global handler both fire. Shadowed
 * wins when both hold (plan 0118 P22). Core rows get no note (spec §8, outside its scope).
 */
export function pluginOverlap(
  entry: MergedKeybinding,
  merged: readonly MergedKeybinding[],
): null | PluginOverlap {
  if (!isPluginKeybindingId(entry.id) || entry.activeKey === "") return null;
  const winner = merged.find(
    (e) => e.customizable && e.activeKey === entry.activeKey,
  );
  if (winner && winner.id !== entry.id) return "shadowed";
  return merged.some((e) => !e.customizable && e.activeKey === entry.activeKey)
    ? "both-run"
    : null;
}
