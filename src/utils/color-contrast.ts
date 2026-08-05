// §54 Theme System — WCAG contrast maths behind the accessible accent pairing (#330)
//
// White on `--color-accent-default` measured 2.54:1 in the default dark theme and
// failed AA in 7 of the 8 built-in themes (Nord 2.00:1, Baram Garden Dark 1.72:1 —
// labels effectively invisible). A hardcoded foreground cannot fix that: Baram
// Garden Light is the mirror case, where white passes at 9.84:1 and black fails at
// 2.13:1. The accent is also a colour the user picks themselves (THEME_COLOR_KEYS),
// so the pairing has to be derived from whatever colour is in play.

/** WCAG 2.x AA minimum contrast for normal-size text. */
export const AA_TEXT_RATIO = 4.5;

const BLACK = "#000000";

/** How far the hover fill moves away from the foreground, as a fraction. */
const HOVER_SHIFT = 0.12;

const WHITE = "#ffffff";

/**
 * Fill for solid accent surfaces that carry text.
 *
 * A light theme's accent-hover is a step darker than its accent, so preferring it
 * when it lets white text clear AA keeps the conventional white-on-accent button
 * using a colour the palette already defines — no invented shade.
 *
 * Dark themes keep the bright accent instead. Darkening their fill would win the
 * text ratio but drop the button's own contrast against the dark page below the
 * 3:1 non-text floor (measured 2.56:1 on Tokyo Night, 2.85:1 on Solarized Dark),
 * trading a text failure for a boundary failure. Their bright fill pairs with dark
 * text, which is what Material 3 does for on-primary in dark schemes.
 */
export function accentSolidFill(
  accent: string,
  accentHover: string,
  base: "dark" | "light",
): string {
  if (base === "dark") return accent;
  if (clearsAA(accent)) return accent;
  return clearsAA(accentHover) ? accentHover : accent;
}

/** WCAG 2.x contrast ratio, or null if either colour is not parseable hex. */
export function contrastRatio(a: string, b: string): null | number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Foreground for text on `fill`: white when it clears AA, black otherwise.
 *
 * The better of white and black is never worse than 4.58:1 against any colour (the
 * two ratios cross at luminance ~0.179), so the black branch always clears AA too.
 * That guarantee — verified over the whole sRGB cube in the tests — is what makes
 * a user-chosen accent safe without asking the user to also pick a foreground.
 *
 * Unparseable input keeps white, which is the pre-#330 behaviour: a colour format
 * this function cannot read is left no worse than it already was.
 */
export function onSolidForeground(fill: string): string {
  return clearsAA(fill) ? WHITE : BLACK;
}

/** Relative luminance per WCAG 2.x, or null if `color` is not parseable hex. */
export function relativeLuminance(color: string): null | number {
  const rgb = parseHexColor(color);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((channel) => channelToLinear(channel / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Hover fill for any solid surface — accent or status.
 *
 * Moves the fill *away* from its own foreground — darker under white text, lighter
 * under black — so the derived pairing's contrast can only rise on hover. That is
 * what lets one foreground token serve both states instead of needing a second one
 * that every `:hover` rule would have to set.
 *
 * The direction MUST come from the foreground, never from a constant. A hardcoded
 * `color-mix(danger 85%, white)` broke Solarized, whose `#dc322f` clears AA with
 * white by 0.13 and so takes a white foreground: lightening then moved the fill
 * toward its own text and dropped it to 3.83:1. Hardcoding `black` instead breaks
 * the other six themes symmetrically.
 */
export function solidHoverFill(solid: string): string {
  const target = onSolidForeground(solid) === WHITE ? 0 : 255;
  return shiftToward(solid, target, HOVER_SHIFT) ?? solid;
}

/** sRGB channel in 0..1 → linear-light value (WCAG 2.x transfer function). */
function channelToLinear(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Whether white text clears AA on `fill`. Unparseable colours count as clearing,
 * so they keep the white foreground they had before this module existed.
 */
function clearsAA(fill: string): boolean {
  const ratio = contrastRatio(WHITE, fill);
  return ratio === null || ratio >= AA_TEXT_RATIO;
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` into 0..255 channels. Null for
 * any other format.
 *
 * Alpha is read and discarded rather than rejected. `#rrggbbaa` is valid CSS and a
 * common export format, and the theme importer only checks that a colour is a
 * string — so rejecting it would send a translucent accent down the unparseable
 * path, where the foreground silently stays white and reintroduces #330 for that
 * user. Compositing it properly needs a backdrop this module does not have, so the
 * opaque channels are the closest honest answer.
 */
function parseHexColor(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const short = hex.length === 3 || hex.length === 4;
  const full = (short ? hex.replace(/./g, (c) => c + c) : hex).slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  if (!short && hex.length !== 6 && hex.length !== 8) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Move every channel `amount` of the way toward `target` (0 = black, 255 = white). */
function shiftToward(
  color: string,
  target: number,
  amount: number,
): null | string {
  const rgb = parseHexColor(color);
  if (rgb === null) return null;
  const hex = rgb
    .map((channel) => Math.round(channel + (target - channel) * amount))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}
