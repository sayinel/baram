// §395 spec 0074 D5 — the colours a decoration may name. A palette name is drawn with a semantic token,
// so it follows the theme; `#rrggbb` is drawn as written. These two forms are the only strings from a
// plugin that reach a style value (the file tree's row leaf sets them as `color` / `background-color`).
import type { FileDecorationPaletteColor } from "../types";

/** D5 — each palette name and the token it is drawn with. */
export const PALETTE: Readonly<Record<FileDecorationPaletteColor, string>> = {
  accent: "var(--color-accent-default)",
  blue: "var(--color-status-info)",
  gray: "var(--color-text-muted)",
  green: "var(--color-status-success)",
  orange: "var(--color-git-modified)",
  purple: "var(--color-callout-abstract)",
  red: "var(--color-status-danger)",
  yellow: "var(--color-status-warning)",
};

/** Six hex digits, either case — not `#rgb`, not an alpha channel. */
const HEX = /^#[0-9a-fA-F]{6}$/u;

/** The style value `color` is drawn with. `color` is a value `paletteColor` returned. */
export function colorValue(color: string): string {
  return Object.hasOwn(PALETTE, color)
    ? PALETTE[color as FileDecorationPaletteColor]
    : color;
}

/**
 * `raw` as a decoration keeps it — a palette name exactly as written, or a hex in lower case so two
 * spellings of one colour compare equal — or `null` when D5 refuses it. `Object.hasOwn`, not `in`: an
 * inherited key (`toString`) is not a palette name.
 */
export function paletteColor(raw: unknown): null | string {
  if (typeof raw !== "string") return null;
  if (Object.hasOwn(PALETTE, raw)) return raw;
  return HEX.test(raw) ? raw.toLowerCase() : null;
}
