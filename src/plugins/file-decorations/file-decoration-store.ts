// §395 spec 0074 D2 · D8 · D9 · D10 · §5.1 — the decorations plugins pushed, and what the file tree
// draws for each path. Two layers: `byPlugin`, what each plugin last set (module state — nothing renders
// it), and the store's `merged`, one merged decoration per key, which the file tree's row leaves read
// (one key each). Every write goes through `commit`, which re-merges only the
// keys it is handed, keeps a result equal to the previous one as the SAME object, and calls `set` only
// when some key changed — so a write re-renders the leaves whose decoration changed and no others.
import type { FileDecoration } from "../types";
import type { PreparedUpdate } from "./validate";

import { create } from "zustand";

import { toBadgeKey } from "../../stores/system/git-badges";
import { iconClassOf } from "./icons";
import { MAX_DECORATED_PATHS, MAX_ROW_BADGES } from "./limits";
import { colorValue } from "./palette";
import { TOO_MANY_PATHS_MESSAGE, undefinedIconMessage } from "./validate";

/** A badge as a row draws it: its text, its colour as a style value, and the plugin's title line. */
export interface DecorationBadge {
  color?: string;
  label: string;
  text: string;
}

/** The icon a row draws instead of its default one: a host class (an SVG mask) or one character. */
export type DecorationIcon =
  { className: string; color?: string } | { color?: string; glyph: string };

/** D8 — what a row draws for one path: up to `MAX_ROW_BADGES` badges, one icon, and the hover text. */
export interface MergedDecoration {
  badges: readonly DecorationBadge[];
  icon?: DecorationIcon;
  title: string;
}

interface FileDecorationState {
  merged: ReadonlyMap<string, MergedDecoration>;
}

export const useFileDecorationStore = create<FileDecorationState>()(() => ({
  merged: new Map(),
}));

/** Each plugin's decorations, by key. Holds only plugins with at least one. */
const byPlugin = new Map<string, Map<string, FileDecoration>>();
/** Each plugin's source label (`pluginSourceLabel`), as its last write gave it. */
const labels = new Map<string, string>();

/** Tests only — forget every decoration. */
export function __resetFileDecorations(): void {
  byPlugin.clear();
  labels.clear();
  useFileDecorationStore.setState({ merged: new Map() });
}

/**
 * D14 — apply one judged call of `pluginId`, whole or not at all: the sentence of the refusal, or `null`.
 * Refused when the plugin would hold more than `MAX_DECORATED_PATHS` paths, or when a decoration names
 * an `icon.svg` the plugin has not defined (judged now, so a `defineFileIcon` queued before this call
 * counts — plan 0127 P26). Within one call a later update of the same path wins.
 */
export function applyDecorations(
  pluginId: string,
  label: string,
  updates: readonly PreparedUpdate<{ absolute: string }>[],
): null | string {
  const own = byPlugin.get(pluginId) ?? new Map<string, FileDecoration>();
  const delta = new Map<string, FileDecoration | null>();
  for (const { decoration, where } of updates) {
    delta.set(decorationKey(where.absolute), decoration);
  }
  let size = own.size;
  for (const [key, decoration] of delta) {
    const held = own.has(key);
    if (decoration === null) {
      if (held) size -= 1;
      continue;
    }
    if (!held) size += 1;
    const icon = decoration.icon;
    if (
      icon !== undefined &&
      "svg" in icon &&
      iconClassOf(pluginId, icon.svg) === undefined
    ) {
      return undefinedIconMessage(icon.svg);
    }
  }
  if (size > MAX_DECORATED_PATHS) return TOO_MANY_PATHS_MESSAGE;
  for (const [key, decoration] of delta) {
    if (decoration === null) own.delete(key);
    else own.set(key, decoration);
  }
  if (own.size > 0) byPlugin.set(pluginId, own);
  else byPlugin.delete(pluginId);
  labels.set(pluginId, label);
  commit(delta.keys());
  return null;
}

/** D15 — `clearFileDecorations`: every decoration of `pluginId` goes; its icons stay. */
export function clearDecorations(pluginId: string): void {
  const own = byPlugin.get(pluginId);
  if (own === undefined) return;
  byPlugin.delete(pluginId);
  commit(own.keys());
}

/** D7 — the key a path's decoration is kept under: `toBadgeKey` (the git dot's rule), without a trailing separator. */
export function decorationKey(path: string): string {
  return toBadgeKey(path).replace(/\/+$/u, "");
}

/** D10 — the app deleted `path`: its key goes, and for a folder every key under `path + "/"`. */
export function dropDecorations(path: string, isDir: boolean): void {
  const base = decorationKey(path);
  const changed = new Set<string>();
  for (const own of byPlugin.values()) {
    for (const key of [...own.keys()]) {
      if (!within(key, base, isDir)) continue;
      own.delete(key);
      changed.add(key);
    }
  }
  pruneEmpty();
  commit(changed);
}

/**
 * D10 — the app renamed or moved `from` to `to`: every plugin's key at `from` (and, for a folder, under
 * `from + "/"`) moves to the same place under `to`. The destination is cleared first — its key and every
 * key under `to + "/"` (plan 0127 P30) — because a key left there by a change outside the app (D13) would
 * otherwise land on the moved entry. Scans every key of every plugin (P27). Precondition: a path is never
 * moved into its own subtree or onto its ancestor (`/v/a` → `/v/a/b`, `/v/a/b` → `/v/a` would drop keys) —
 * `rename(2)` fails with EINVAL, the IPC fails, and D10 sends no notice for a failed rename.
 */
export function moveDecorations(
  from: string,
  to: string,
  isDir: boolean,
): void {
  const source = decorationKey(from);
  const target = decorationKey(to);
  if (source === target) return;
  const changed = new Set<string>();
  for (const own of byPlugin.values()) {
    for (const key of [...own.keys()]) {
      if (!within(key, target, true)) continue;
      own.delete(key);
      changed.add(key);
    }
    for (const [key, decoration] of [...own]) {
      if (!within(key, source, isDir)) continue;
      own.delete(key);
      changed.add(key);
      const moved = target + key.slice(source.length);
      own.set(moved, decoration);
      changed.add(moved);
    }
  }
  pruneEmpty();
  commit(changed);
}

/** D15 — the plugin is unloaded: its decorations go and its label is forgotten. */
export function releaseDecorations(pluginId: string): void {
  clearDecorations(pluginId);
  labels.delete(pluginId);
}

/** A selector for one key — what a leaf subscribes with. */
export function selectDecoration(
  key: string,
): (state: FileDecorationState) => MergedDecoration | undefined {
  return (state) => state.merged.get(key);
}

/** Re-merge `keys` and `set` once, only when one of them changed (D9). */
function commit(keys: Iterable<string>): void {
  const { merged } = useFileDecorationStore.getState();
  const order = [...byPlugin.keys()].sort(compareIds);
  let next: Map<string, MergedDecoration> | null = null;
  for (const key of keys) {
    const now = mergeKey(key, order);
    const was = merged.get(key);
    const same =
      now === undefined
        ? was === undefined
        : was !== undefined && sameMerged(was, now);
    if (same) continue;
    next ??= new Map(merged);
    if (now === undefined) next.delete(key);
    else next.set(key, now);
  }
  if (next !== null) useFileDecorationStore.setState({ merged: next });
}

/**
 * Code-unit order — the rule `compareIds` in `plugin-entry-points.ts` uses; not `localeCompare`, which
 * depends on the locale. Copied, not imported: importing that module would pull its UI stores in here.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** D8 — one key's merged decoration over the plugins in `order`, or `undefined` when none holds one. */
function mergeKey(
  key: string,
  order: readonly string[],
): MergedDecoration | undefined {
  const lines: string[] = [];
  const badges: DecorationBadge[] = [];
  let icon: DecorationIcon | undefined;
  for (const pluginId of order) {
    const decoration = byPlugin.get(pluginId)?.get(key);
    if (decoration === undefined) continue;
    const name = labels.get(pluginId) ?? pluginId;
    const said = decoration.tooltip ?? decoration.badge;
    const line = said === undefined ? name : `${name}: ${said}`;
    lines.push(line);
    const color =
      decoration.color === undefined ? undefined : colorValue(decoration.color);
    const tint = color === undefined ? {} : { color };
    if (icon === undefined && decoration.icon !== undefined) {
      icon =
        "glyph" in decoration.icon
          ? { ...tint, glyph: decoration.icon.glyph }
          : {
              ...tint,
              className: iconClassOf(pluginId, decoration.icon.svg) ?? "",
            };
    }
    if (decoration.badge !== undefined && badges.length < MAX_ROW_BADGES) {
      badges.push({ ...tint, label: line, text: decoration.badge });
    }
  }
  if (lines.length === 0) return undefined;
  return icon === undefined
    ? { badges, title: lines.join("\n") }
    : { badges, icon, title: lines.join("\n") };
}

/** Drop the maps of plugins left without a decoration. */
function pruneEmpty(): void {
  for (const [pluginId, own] of byPlugin) {
    if (own.size === 0) byPlugin.delete(pluginId);
  }
}

/** Structural equality of two merged decorations — the gate that keeps an unchanged key's object (D9). */
function sameMerged(a: MergedDecoration, b: MergedDecoration): boolean {
  if (a.title !== b.title || a.badges.length !== b.badges.length) return false;
  for (let i = 0; i < a.badges.length; i += 1) {
    const x = a.badges[i];
    const y = b.badges[i];
    if (x.text !== y.text || x.label !== y.label || x.color !== y.color) {
      return false;
    }
  }
  if (a.icon === undefined || b.icon === undefined) return a.icon === b.icon;
  if (a.icon.color !== b.icon.color) return false;
  if ("glyph" in a.icon)
    return "glyph" in b.icon && a.icon.glyph === b.icon.glyph;
  return "className" in b.icon && a.icon.className === b.icon.className;
}

/** `key` is `base`, or — with `withChildren` — under `base + "/"`. */
function within(key: string, base: string, withChildren: boolean): boolean {
  return key === base || (withChildren && key.startsWith(`${base}/`));
}
