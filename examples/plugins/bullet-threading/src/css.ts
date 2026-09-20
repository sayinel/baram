import { CURSOR_CLASS, THREAD_CLASS } from "./threading";

/** How the item holding the caret is marked. */
export type CaretMarker = "filled" | "halo" | "none";

export interface ThreadSettings {
  caretMarker: CaretMarker;
  color: string;
  lineWidth: number;
  onlyWhenFocused: boolean;
  showElbow: boolean;
}

export const DEFAULT_SETTINGS: ThreadSettings = {
  caretMarker: "halo",
  color: "var(--color-accent-default)",
  lineWidth: 2,
  onlyWhenFocused: false,
  showElbow: true,
};

const CARET_MARKERS: readonly CaretMarker[] = ["filled", "halo", "none"];

/**
 * What a colour may contain.
 *
 * The host guarantees a settings field's DECLARED TYPE, not a usable value — the record
 * is a config file the user can edit, and this string is pasted into a stylesheet. The
 * check is a character allowlist rather than a colour parser: every character that could
 * end the declaration and start a rule of its own (`;`, `{`, `}`, `:`, `/`, `@`) is
 * absent from it, which is the property that matters. It stays wide enough for hex,
 * `rgb()`, `hsl()`, a colour name, and `var(--…)` — pointing the thread at one of the
 * app's own tokens is a reasonable thing to want.
 */
const SAFE_COLOR = /^[\w#(),.%\s-]{1,64}$/;

/**
 * Bumped whenever the stylesheet changes. Emitted as `--bt-build` so a running app can
 * say which build it is showing — without it, "the rule did not apply" and "the reload
 * kept the old module" are indistinguishable from a screenshot.
 */
const STYLE_REVISION = "5";

const MIN_WIDTH = 0.5;
const MAX_WIDTH = 8;

/**
 * ‼️ Every field is re-checked here even though the host now enforces the same bounds it
 * declares (`min`/`max` on `lineWidth`, `options` on `caretMarker`, the colour allowlist).
 * That is not redundancy to delete: the host guarantees what the CURRENT manifest says, and
 * a plugin is handed values by whatever Baram the user is running — one that predates a
 * field's constraints resolves it without them. The manifest is a request; this is the
 * plugin's own answer, and it is what decides what goes into the stylesheet.
 */
export function resolveSettings(raw: Record<string, unknown>): ThreadSettings {
  return {
    caretMarker: resolveOneOf(
      raw.caretMarker,
      CARET_MARKERS,
      DEFAULT_SETTINGS.caretMarker,
    ),
    color: resolveColor(raw.color),
    lineWidth: resolveWidth(raw.lineWidth),
    onlyWhenFocused: resolveBoolean(
      raw.onlyWhenFocused,
      DEFAULT_SETTINGS.onlyWhenFocused,
    ),
    showElbow: resolveBoolean(raw.showElbow, DEFAULT_SETTINGS.showElbow),
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
  // `onlyWhenFocused` is one selector prefix, because ProseMirror already maintains the
  // fact: `prosemirror-view` adds and removes `ProseMirror-focused` on `view.dom`, and
  // `@tiptap/core` prepends `tiptap` to that SAME element's class list — so the two land
  // together and no listener is needed here. The VARIABLE block below stays on plain
  // `.tiptap`: it paints nothing, and `--bt-build` has to stay readable from a running app
  // whether or not the editor happens to have focus.
  const root = settings.onlyWhenFocused
    ? `.tiptap.ProseMirror-focused`
    : `.tiptap`;
  const railX = `calc(-1 * (var(--list-gutter, 1.4em) + 1em))`;
  // `railX` is the axis the editor's own indent guide sits on, but the two draw around
  // it differently: lists.css gives the guide `width: --guide-width` and pulls it back
  // by half (`margin-left: calc(var(--guide-width) / -2)`), so it is CENTRED on the
  // axis, while a `border-left` starts at the axis and grows right. The guide's left
  // half therefore showed past the thread. Same correction, same reason.
  const centreOnRail = `calc(var(--bt-width) / -2)`;
  const stroke = `var(--bt-width) solid var(--bt-color)`;
  // Both list shapes Baram produces: a plain nested list sits directly in the item, a
  // nested TASK list sits inside the task item's content `<div>`.
  //
  // `:not(.bt-thread-cursor)` on the PARENT is what stops the thread at the caret.
  // Without it the caret's own item is still a thread member, so its children get
  // segments too and the thread runs on past the end into the subtree below.
  // How far the first segment has to climb to meet the parent's marker.
  const reachUp = `calc(-1 * (var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em))`;
  const firstChild = (suffix: string) => childItem(`${suffix}:first-child`);
  const childItem = (suffix: string) =>
    [
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > :is(ul, ol) > li${suffix}::after`,
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol) > li${suffix}::after`,
    ].join(",\n");

  return [
    // `--bt-gap` is the ONE number here that is not derived: it mirrors `li`'s own
    // `margin: 0.15em 0` in lists.css, which is not exposed as a custom property, and is
    // what lets consecutive segments meet across the collapsed margin between two items.
    // If that margin changes, the thread grows a hairline gap between siblings — a
    // cosmetic drift, not a break, but this is the line to come back to.
    // `--bt-build` is a version marker with no visual effect: it is the only way to
    // tell from a running app WHICH build of this plugin is live, and a reload that
    // silently kept the old module looks exactly like a rule that did not apply.
    // Read it with
    //   getComputedStyle(document.querySelector(".tiptap")).getPropertyValue("--bt-build")
    `.tiptap{--bt-build:"${STYLE_REVISION}";--bt-color:${settings.color};` +
      `--bt-width:${settings.lineWidth}px;--bt-gap:0.15em;--bt-radius:0.6em}`,

    // The elbow: one box carrying a left and a bottom border, curved where they meet.
    // Only on an item that is itself inside a list item — a top-level item has no parent
    // rail to descend from, and the stroke would hang in the left margin.
    `${root} li li.${THREAD_CLASS}::after{` +
      `position:absolute;` +
      `left:${railX};` +
      `margin-left:${centreOnRail};` +
      `top:calc(-1 * var(--bt-gap));` +
      `width:calc(var(--list-gutter, 1.4em) + 0.5em);` +
      `height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em + ` +
      `var(--bt-width) / 2);` +
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
      `margin-left:${centreOnRail};` +
      `top:calc(-1 * var(--bt-gap));` +
      `bottom:0;` +
      `border-left:${stroke};` +
      `pointer-events:none;` +
      `content:""}`,

    // ...and no further. The thread stops where the caret is; siblings below it are not
    // on the way to anywhere.
    `${childItem(`.${THREAD_CLASS} ~ li`)}{border-color:transparent}`,

    // Reach up to the PARENT's own marker, so the thread leaves a bullet rather than
    // appearing out of the gap below it. The distance is exact rather than tuned:
    // `li p` has no margin in lists.css, so a child list's top edge is the parent's
    // first line-box bottom, and the marker is centred half a line-box above that.
    // Both first-child shapes need it — a plain sibling segment (top/bottom) and a
    // threaded item's elbow (top/height), which has to grow by what it moved up.
    `${firstChild(`:not(.${THREAD_CLASS})`)}{top:${reachUp}}`,
    `${firstChild(`.${THREAD_CLASS}`)}{` +
      `top:${reachUp};` +
      `height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 1em + ` +
      `var(--bt-width) / 2)}`,

    // The bullets along the thread become rings, which is what makes the stroke read as
    // ending in something rather than stopping near it. The centre is filled with the
    // editor's background, so the segment running underneath is masked by the ring
    // itself and no arithmetic is needed to stop the line short of the marker —
    // `z-index` is only needed because `::after` would otherwise paint over `::before`.
    // Ordered markers are text and task items draw no marker at all (`content: none`),
    // so both fall through to the colour rule below.
    `${root} ul > li.${THREAD_CLASS}::before{` +
      `z-index:1;` +
      `background:var(--color-editor-bg);` +
      `box-shadow:0 0 0 var(--bt-width) var(--bt-color)}`,

    // Everything else on the thread that paints with `currentcolor` — ordered numbers,
    // and the bullet's fallback if the rule above is ever overridden.
    `${root} li.${THREAD_CLASS}::before{color:var(--bt-color)}`,

    // The end of the thread is filled rather than hollow: in a deep outline the stroke
    // alone says which BRANCH you are on, not which item. `halo` adds a soft outer glow
    // on top of that, and `none` emits neither — the caret's item then keeps the same
    // hollow ring as its ancestors, which is the quietest the plugin gets while still
    // drawing a thread.
    //
    // ‼️ THREE states rather than a boolean because the rendering genuinely has three.
    // `filled` is not a degraded `halo`: the fill is what marks the item and the glow is
    // what makes it loud, and they are worth separating.
    ...(settings.caretMarker === "none"
      ? []
      : [
          `${root} ul > li.${CURSOR_CLASS}::before{` +
            `background:var(--bt-color);` +
            `box-shadow:0 0 0 var(--bt-width) var(--bt-color)` +
            (settings.caretMarker === "halo"
              ? `,0 0 0 calc(var(--bt-width) * 3) ` +
                `color-mix(in srgb, var(--bt-color) 25%, transparent)`
              : ``) +
            `}`,

          // ...and the ordered-list equivalent, where there is no dot to fill. A box around
          // the number reads as a form field; a glow on the glyph itself is the same gesture
          // as the bullet's halo, so `text-shadow` rather than `box-shadow` — the latter
          // would outline the marker's rectangular box.
          `${root} ol > li.${CURSOR_CLASS}::before{` +
            `color:var(--bt-color);` +
            `font-weight:700;` +
            (settings.caretMarker === "halo"
              ? `text-shadow:0 0 calc(var(--bt-width) * 2.5) ` +
                `color-mix(in srgb, var(--bt-color) 55%, transparent);`
              : ``) +
            `}`,
        ]),

    // Ordered markers are TEXT, and text has nothing to hide the stroke the way a
    // bullet's ring does — so the line ran into the digits at the end of the elbow AND
    // through them on the way down, because the guide axis falls inside a number's box
    // while it falls inside a bullet's too (the ring is simply what conceals it there).
    //
    // Cutting the elbow short by a computed length was the first attempt and it cannot
    // work: the gap it leaves is the gutter minus the GLYPH, and lists.css floors the
    // gutter at 1.4em, so the same length reads as loose behind `a.` and tight behind
    // `iii.`. CSS cannot measure a glyph.
    //
    // Masking can. The marker gets the editor's own background and a left padding, and
    // because it is anchored `right: 100%` the padding grows the box LEFTWARD without
    // moving the number. Whatever runs underneath is hidden for exactly that distance
    // past the glyph's left edge — one constant gap for every marker width, and the
    // same mechanism the ring already uses.
    `${root} ol > li.${THREAD_CLASS}::before{` +
      `z-index:1;` +
      `background:var(--color-editor-bg);` +
      `padding-left:0.3em}`,
  ].join("\n");
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function resolveColor(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.color;
  const trimmed = value.trim();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : DEFAULT_SETTINGS.color;
}

function resolveOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function resolveWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.lineWidth;
  }
  return value < MIN_WIDTH || value > MAX_WIDTH
    ? DEFAULT_SETTINGS.lineWidth
    : value;
}
