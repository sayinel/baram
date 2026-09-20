import { CURSOR_CLASS, THREAD_CLASS } from "./threading";

export interface ThreadSettings {
  color: string;
  lineWidth: number;
  showElbow: boolean;
}

export const DEFAULT_SETTINGS: ThreadSettings = {
  color: "var(--color-accent-default)",
  lineWidth: 1.5,
  showElbow: true,
};

/**
 * What a colour may contain.
 *
 * The host guarantees a settings field's DECLARED TYPE, not a usable value — the record
 * is a config file the user can edit, and this string is pasted into a stylesheet. The
 * check is a character allowlist rather than a colour parser: every character that could
 * end the declaration and start a rule of its own (`;`, `{`, `}`, `:`, `/`, `@`) is
 * absent from it, which is the property that matters. It stays wide enough for hex,
 * `rgb()`, `hsl()`, a colour name, and `var(--token)` — pointing the thread at one of the
 * app's own tokens is a reasonable thing to want.
 */
const SAFE_COLOR = /^[\w#(),.%\s-]{1,64}$/;

const MIN_WIDTH = 0.5;
const MAX_WIDTH = 8;

export function resolveSettings(raw: Record<string, unknown>): ThreadSettings {
  return {
    color: resolveColor(raw.color),
    lineWidth: resolveWidth(raw.lineWidth),
    showElbow:
      typeof raw.showElbow === "boolean"
        ? raw.showElbow
        : DEFAULT_SETTINGS.showElbow,
  };
}

/**
 * The stylesheet, built against the geometry `src/styles/editor/lists.css` already
 * establishes — nothing here measures anything. Each term was re-read from that file
 * when this was written:
 *
 * - The PARENT's rail sits at `-(--list-gutter + 1em)`. An item starts one gutter in
 *   from its list's padding box (`--list-gutter: 1.4em`, widened by `ol` for two- and
 *   three-digit numbers), and the static grey rail is drawn 1em left of that box
 *   (`li :is(ul, ol)::before { left: -1em }`) — so the two land on the same subpixel and
 *   the thread traces the rail instead of sitting beside it.
 * - The first line's centre is `--editor-line-height * 0.5em`, the expression the
 *   markers already use to centre themselves. Settings writes that property onto
 *   `.tiptap`.
 *
 * Every term is one of the editor's own custom properties, so the thread follows a
 * font-size change, a line-height change, and an ordered list widening its gutter, with
 * nothing to keep in sync.
 */
export function buildCss(settings: ThreadSettings): string {
  const railX = `calc(-1 * (var(--list-gutter, 1.4em) + 1em))`;
  const stroke = `var(--bt-width) solid var(--bt-color)`;
  // Both list shapes Baram produces: a plain nested list sits directly in the item, a
  // nested TASK list sits inside the task item's content `<div>`.
  //
  // `:not(.bt-thread-cursor)` on the PARENT is what stops the thread at the caret.
  // Without it the caret's own item is still a thread member, so its children get
  // segments too and the thread runs on past the end into the subtree below.
  const childItem = (suffix: string) =>
    [
      `.tiptap li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > :is(ul, ol) > li${suffix}::after`,
      `.tiptap li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol) > li${suffix}::after`,
    ].join(",\n");

  return [
    // `--bt-gap` is the ONE number here that is not derived: it mirrors `li`'s own
    // `margin: 0.15em 0` in lists.css, which is not exposed as a custom property, and is
    // what lets consecutive segments meet across the collapsed margin between two items.
    // If that margin changes, the thread grows a hairline gap between siblings — a
    // cosmetic drift, not a break, but this is the line to come back to.
    `.tiptap{--bt-color:${settings.color};--bt-width:${settings.lineWidth}px;--bt-gap:0.15em;--bt-radius:0.45em}`,

    // The elbow: one box carrying a left and a bottom border, curved where they meet.
    // Only on an item that is itself inside a list item — a top-level item has no parent
    // rail to descend from, and the stroke would hang in the left margin.
    `.tiptap li li.${THREAD_CLASS}::after{` +
      `position:absolute;` +
      `left:${railX};` +
      `top:calc(-1 * var(--bt-gap));` +
      `width:calc(var(--list-gutter, 1.4em) + 0.5em);` +
      `height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em);` +
      `border-left:${stroke};` +
      (settings.showElbow
        ? `border-bottom:${stroke};border-bottom-left-radius:var(--bt-radius);`
        : ``) +
      `pointer-events:none;` +
      `content:""}`,

    // The siblings above the threaded item, so the thread reaches it unbroken. Each
    // segment starts one collapsed margin high to close the gap to the item above.
    `${childItem(`:not(.${THREAD_CLASS})`)}{` +
      `position:absolute;` +
      `left:${railX};` +
      `top:calc(-1 * var(--bt-gap));` +
      `bottom:0;` +
      `border-left:${stroke};` +
      `pointer-events:none;` +
      `content:""}`,

    // ...and no further. The thread stops where the caret is; siblings below it are not
    // on the way to anywhere.
    `${childItem(`.${THREAD_CLASS} ~ li`)}{border-color:transparent}`,

    // The bullets along the thread. The markers paint with `currentcolor`, so setting
    // `color` is all it takes.
    `.tiptap li.${THREAD_CLASS}::before{color:var(--bt-color)}`,

    // The one at the end carries a ring as well: in a deep outline the thread alone says
    // which BRANCH you are on, not which item.
    `.tiptap li.${CURSOR_CLASS}::before{` +
      `color:var(--bt-color);` +
      `box-shadow:0 0 0 var(--bt-width) var(--bt-color)}`,
  ].join("\n");
}

function resolveColor(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.color;
  const trimmed = value.trim();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : DEFAULT_SETTINGS.color;
}

function resolveWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.lineWidth;
  }
  return value < MIN_WIDTH || value > MAX_WIDTH
    ? DEFAULT_SETTINGS.lineWidth
    : value;
}
