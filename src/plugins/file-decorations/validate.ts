// §395 spec 0074 D4 · D5 · D6 · D7 · D14 · §6 — what a plugin's file tree call may carry, judged by one
// set of rules for both tiers. The host judges every call; the sandbox judges it before sending, so its
// author gets the same sentence at once. A sentence names a limit or a field and carries no text the
// plugin sent; the one exception is an icon name, which has passed `ICON_NAME` first (§6).
//
// Pure — it reaches no store — so the sandbox realm may import it.
import type { FileDecoration } from "../types";

import { isAbsolutePath } from "../../utils/path-utils";
import {
  BLANK_ICON,
  MAX_ENTRY_DESCRIPTION_CHARS,
  sanitizePluginText,
} from "../plugin-text";
import { utf8Bytes } from "../rendered/limits";
import {
  MAX_BADGE_GRAPHEMES,
  MAX_DECORATED_PATHS,
  MAX_DECORATION_GLYPH_CHARS,
  MAX_DECORATION_PATH_CHARS,
  MAX_DECORATION_UPDATES,
  MAX_FILE_ICON_NAME_CHARS,
  MAX_FILE_ICON_SVG_BYTES,
  MAX_FILE_ICONS,
} from "./limits";
import { paletteColor } from "./palette";

/** One update, judged: its decoration as it will be kept (`null` removes), and where it points — `T` is the caller's `locate` answer. */
export interface PreparedUpdate<T extends object> {
  decoration: FileDecoration | null;
  where: T;
}

export const COLOR_MESSAGE =
  'decoration.color must be a palette name (accent, blue, gray, green, orange, purple, red, yellow) or "#rrggbb"';
export const CONTEXT_NOT_STRING_MESSAGE =
  "update.context must be a string when it is given";
export const DECORATION_NOT_OBJECT_MESSAGE =
  "update.decoration must be an object or null";
export const ICON_NAME_MESSAGE = `defineFileIcon: the name must be 1–${MAX_FILE_ICON_NAME_CHARS} of A–Z, a–z, 0–9, "_" and "-"`;
export const ICON_SHAPE_MESSAGE =
  "decoration.icon must be { glyph } or { svg }";
export const ICON_SVG_NAME_MESSAGE = `decoration.icon.svg must be an icon name: 1–${MAX_FILE_ICON_NAME_CHARS} of A–Z, a–z, 0–9, "_" and "-"`;
export const NO_ACTIVE_CONTEXT_MESSAGE =
  "update.context was left out and no context is active";
export const PATH_NOT_ABSOLUTE_MESSAGE = "update.path must be an absolute path";
export const PATH_TOO_LONG_MESSAGE = `update.path is longer than ${MAX_DECORATION_PATH_CHARS} UTF-16 units`;
export const RELATIVE_PATH_MESSAGE =
  'update.path must be relative to the context root: "/" between names, no leading "/", no empty, "." or ".." name, no "\\"';
export const RELEASED_MESSAGE =
  "the plugin was unloaded before this call was applied";
export const SVG_NOT_STRING_MESSAGE =
  "defineFileIcon: the SVG must be a string";
export const SVG_ROOT_MESSAGE =
  "defineFileIcon: once sanitized, the SVG must be one svg element";
export const SVG_TOO_LARGE_MESSAGE = `defineFileIcon: the SVG is larger than ${MAX_FILE_ICON_SVG_BYTES} bytes of UTF-8`;
export const TOO_MANY_ICONS_MESSAGE = `a plugin may define at most ${MAX_FILE_ICONS} file icons`;
export const TOO_MANY_PATHS_MESSAGE = `a plugin may decorate at most ${MAX_DECORATED_PATHS} paths`;
export const TOO_MANY_UPDATES_MESSAGE = `setFileDecorations takes at most ${MAX_DECORATION_UPDATES} updates in one call`;
export const TOOLTIP_NOT_STRING_MESSAGE = "decoration.tooltip must be a string";
export const UNKNOWN_CONTEXT_MESSAGE =
  'update.context names no registered context, or a file context with a path other than ""';
export const UPDATE_NOT_OBJECT_MESSAGE =
  "each update must be an object { path, decoration }";
export const UPDATES_NOT_ARRAY_MESSAGE =
  "setFileDecorations takes an array of updates";

/** D6 — an icon name. */
const ICON_NAME = new RegExp(
  `^[A-Za-z0-9_-]{1,${MAX_FILE_ICON_NAME_CHARS}}$`,
  "u",
);

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * `raw` as one decoration keeps it, `null` when it holds no field (D4: `{}` is `null`, and so is a
 * decoration whose only field cleans to nothing), or the sentence that refuses it. Each field is read
 * once, so a getter cannot pass with one value and be kept with another. Fields other than the four are
 * left behind (P29).
 */
export function cleanDecoration(raw: unknown): FileDecoration | null | string {
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return DECORATION_NOT_OBJECT_MESSAGE;
  }
  const { badge, color, icon, tooltip } = raw as Readonly<
    Record<string, unknown>
  >;
  const kept: FileDecoration = {};
  if (badge !== undefined) {
    const checked = checkGlyph(badge, "decoration.badge", MAX_BADGE_GRAPHEMES);
    if (typeof checked === "string") return checked;
    kept.badge = checked.text;
  }
  if (color !== undefined) {
    const value = paletteColor(color);
    if (value === null) return COLOR_MESSAGE;
    kept.color = value as FileDecoration["color"];
  }
  if (icon !== undefined) {
    const checked = checkIcon(icon);
    if (typeof checked === "string") return checked;
    kept.icon = checked;
  }
  if (tooltip !== undefined) {
    if (typeof tooltip !== "string") return TOOLTIP_NOT_STRING_MESSAGE;
    const line = sanitizePluginText(tooltip, MAX_ENTRY_DESCRIPTION_CHARS);
    if (line !== "") kept.tooltip = line;
  }
  return Object.keys(kept).length === 0 ? null : kept;
}

/**
 * §6 · plan 0127 P24 — the refusal for a call made without `filetree`, the same in both tiers: the
 * trusted `require("filetree", method)` (`trusted/ui-api.ts`) builds exactly this sentence.
 */
export function fileTreeCapabilityMessage(
  method: "clearFileDecorations" | "defineFileIcon" | "setFileDecorations",
): string {
  return `Plugin requires "filetree" capability to call ui.${method}. Add "filetree" to the capabilities array in baram-plugin.json.`;
}

/** D6 — why `defineFileIcon(name, svg)` is refused before it waits its turn, or `null`. */
export function iconCallProblem(name: unknown, svg: unknown): null | string {
  if (typeof name !== "string" || !ICON_NAME.test(name)) {
    return ICON_NAME_MESSAGE;
  }
  if (typeof svg !== "string") return SVG_NOT_STRING_MESSAGE;
  return utf8Bytes(svg) > MAX_FILE_ICON_SVG_BYTES
    ? SVG_TOO_LARGE_MESSAGE
    : null;
}

/**
 * D14 — `raw` as a list of judged updates, or the sentence of its first refusal: the call is refused
 * whole, never applied in part. `locate` reads one item's path fields — `trustedLocate`,
 * `relativeLocate`, or the host's resolver for the sandboxed tier — and answers where it points or why
 * it cannot.
 */
export function prepareUpdates<T extends object>(
  raw: unknown,
  locate: (item: Readonly<Record<string, unknown>>) => string | T,
): PreparedUpdate<T>[] | string {
  if (!Array.isArray(raw)) return UPDATES_NOT_ARRAY_MESSAGE;
  if (raw.length > MAX_DECORATION_UPDATES) return TOO_MANY_UPDATES_MESSAGE;
  const prepared: PreparedUpdate<T>[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return UPDATE_NOT_OBJECT_MESSAGE;
    }
    const fields = item as Readonly<Record<string, unknown>>;
    const where = locate(fields);
    if (typeof where === "string") return where;
    const decoration = cleanDecoration(fields.decoration);
    if (typeof decoration === "string") return decoration;
    prepared.push({ decoration, where });
  }
  return prepared;
}

/**
 * D7 — a sandboxed update's `path` and `context`, as `locateInContext` writes a path: `""` (the context
 * root) or names joined by "/", none empty, "." or "..", and no backslash. The context is resolved by the
 * host when it receives the call.
 */
export function relativeLocate(
  item: Readonly<Record<string, unknown>>,
): string | { context?: string; path: string } {
  const { context, path } = item;
  if (typeof path !== "string") return RELATIVE_PATH_MESSAGE;
  if (path.length > MAX_DECORATION_PATH_CHARS) return PATH_TOO_LONG_MESSAGE;
  if (path !== "" && !isRelativePosix(path)) return RELATIVE_PATH_MESSAGE;
  if (context !== undefined && typeof context !== "string") {
    return CONTEXT_NOT_STRING_MESSAGE;
  }
  return context === undefined ? { path } : { context, path };
}

/** D7 — a trusted update's `path`: absolute (`isAbsolutePath`) and at most 4,096 UTF-16 units. */
export function trustedLocate(
  item: Readonly<Record<string, unknown>>,
): string | { absolute: string } {
  const { path } = item;
  if (typeof path !== "string" || !isAbsolutePath(path)) {
    return PATH_NOT_ABSOLUTE_MESSAGE;
  }
  return path.length > MAX_DECORATION_PATH_CHARS
    ? PATH_TOO_LONG_MESSAGE
    : { absolute: path };
}

/** D6 · §6 — an `icon.svg` the plugin has not defined. `name` passed `ICON_NAME`, so it may be quoted. */
export function undefinedIconMessage(name: string): string {
  return `decoration.icon.svg names "${name}", which this plugin has not defined with defineFileIcon`;
}

/**
 * D14 — a badge (`most` 2) or a glyph icon (`most` 1): at most 16 UTF-16 units as sent, then
 * `sanitizePluginText`, then not blank (`BLANK_ICON`), then at most `most` graphemes.
 */
function checkGlyph(
  raw: unknown,
  field: "decoration.badge" | "decoration.icon.glyph",
  most: number,
): string | { text: string } {
  if (typeof raw !== "string") return `${field} must be a string`;
  if (raw.length > MAX_DECORATION_GLYPH_CHARS) {
    return `${field} is longer than ${MAX_DECORATION_GLYPH_CHARS} UTF-16 units`;
  }
  const text = sanitizePluginText(raw, MAX_DECORATION_GLYPH_CHARS);
  if (BLANK_ICON.test(text)) return `${field} draws nothing`;
  if ([...graphemes.segment(text)].length > most) {
    return most === 1
      ? `${field} must be one character`
      : `${field} must be 1–${most} characters`;
  }
  return { text };
}

/** D4 · D6 — `{ glyph }` or `{ svg }`, exactly one of the two. */
function checkIcon(raw: unknown): string | { glyph: string } | { svg: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return ICON_SHAPE_MESSAGE;
  }
  const { glyph, svg } = raw as Readonly<Record<string, unknown>>;
  if ((glyph === undefined) === (svg === undefined)) return ICON_SHAPE_MESSAGE;
  if (glyph !== undefined) {
    const checked = checkGlyph(glyph, "decoration.icon.glyph", 1);
    return typeof checked === "string" ? checked : { glyph: checked.text };
  }
  return typeof svg === "string" && ICON_NAME.test(svg)
    ? { svg }
    : ICON_SVG_NAME_MESSAGE;
}

/** Names joined by "/", none empty, "." or "..", and no backslash anywhere. */
function isRelativePosix(path: string): boolean {
  return (
    !path.includes("\\") &&
    path
      .split("/")
      .every((name) => name !== "" && name !== "." && name !== "..")
  );
}
