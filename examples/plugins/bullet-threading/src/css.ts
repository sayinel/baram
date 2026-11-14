import { CURSOR_CLASS, RUNG_LIST_CLASS, THREAD_CLASS } from "./threading";

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
const STYLE_REVISION = "9";

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
 * - The PARENT's rail sits at `--list-guide-left − --list-gutter`. An item starts one
 *   gutter in from its list's padding box (`--list-gutter: 1.4em`, widened by `ol` for
 *   wider markers), and the static grey rail is drawn `--list-guide-left` from that box
 *   (`li :is(ul, ol)::before { left: var(--list-guide-left) }`) — so the two land on the
 *   same subpixel and the thread traces the rail instead of sitting beside it. The host
 *   derives that offset from the parent's marker: -1em under a bullet, further left under
 *   a number whose digits line up on their first character. A host that predates the
 *   variable draws every rail at -1em, which is the fallback here.
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
  const railX = `calc(var(--list-guide-left, -1em) - var(--list-gutter, 1.4em))`;
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
  const childItem = (suffix: string) =>
    [
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > :is(ul, ol) > li${suffix}::after`,
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol) > li${suffix}::after`,
    ].join(",\n");
  // The PARENT's own paragraphs above the sub-list the thread runs into — the stretch from
  // its marker down to the first child, whose length is the paragraphs' height and so is
  // known to nobody but them. `:has(~ :is(ul, ol) > li.bt-thread)` is that condition read
  // literally: a later sibling of the paragraph is a list holding the next rung. That
  // leaves out a paragraph after the sub-list, and every paragraph of an item whose next
  // rung sits in a list INSIDE a blockquote or toggle of the item — `thread.ts` makes
  // that item a rung all the same, but no rule here draws the way into such a list, so a
  // stroke from its paragraphs would start at the marker and join nothing.
  //
  // The task shape names `taskItem` rather than any `div`, unlike `childItem`: a plain item
  // can hold a block that is a `div` with paragraphs directly inside it (a toggle, indented
  // 1.4em), and a rail placed from those would land off the parent's marker.
  //
  // `block` is which of the parent's blocks: a paragraph, or an image — `node-image` is the
  // class `@tiptap/react` puts on the wrapper it mounts every React node view in
  // (`node-<type name>`), which is the image's box in the item's flow.
  const leadingBlock = (block: string, suffix: string) =>
    [
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > ${block}:has(~ :is(ul, ol) > li.${THREAD_CLASS})${suffix}`,
      `${root} li[data-type="taskItem"].${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > ${block}:has(~ :is(ul, ol) > li.${THREAD_CLASS})${suffix}`,
    ].join(",\n");
  const leading = ":is(p, .node-image)";
  // The rung's sub-list, as the block straight after an image.
  const nextIsRungList = `:has(+ :is(ul, ol) > li.${THREAD_CLASS})`;
  // An item's first block. The fold arrow is a ProseMirror widget placed at the start of
  // the item's content (`fold-decorations.ts`), so in an item with children it is the
  // first element and the first block is the one after it.
  const firstBlock = ":is(:first-child, .fold-arrow:first-child + *)";
  // An item that has an image at `position` among its blocks — directly, or in a task
  // item's content div. Only a TASK item's div: in a plain item a div is a block of its
  // own (a toggle), and what sits inside it is not this item's edge.
  const imageAt = (position: string) =>
    `:is(:has(> .node-image${position}), ` +
    `[data-type="taskItem"]:has(> div > .node-image${position}))`;
  // The parent's rail, seen from its own paragraph rather than from a child. The host's
  // `--list-guide-left` is the wrong value here — it is declared on the nested list, which
  // is the paragraph's SIBLING, and what the paragraph of a nested item inherits under
  // that name is the rail of the item it is nested in, the one its own elbow descends
  // from. So this is the expression lists.css builds that variable from: the parent's
  // `--list-marker-axis` (inherited from the item, so it is the parent's own) plus `li`'s
  // `padding-left: 0.5em`, the distance from the parent's edge to its content, where the
  // paragraph starts. The fallback lands on the same -1em the child-side `railX` falls
  // back to — where a host without the variable hangs its guide.
  const leadRailX = `calc(-0.5em - var(--list-marker-axis, 0.5em))`;

  return [
    // `--bt-gap` is the ONE number here that is not derived: it mirrors `li`'s own
    // `margin: 0.15em 0` in lists.css, which is not exposed as a custom property, and is
    // what lets consecutive segments meet across the collapsed margin between two items.
    // If that margin changes, the thread grows a hairline gap between siblings — a
    // cosmetic drift, not a break, but this is the line to come back to.
    // `--bt-image-gap` is the second such number, and the same kind of drift: it mirrors
    // the image node view's `margin: 0.5em 0` in editor/media.css. That margin sits outside
    // every box the thread is drawn from — above and below an image in the parent, and below
    // a sibling whose last block is an image, where it collapses through the item's bottom
    // edge — so the strokes beside it are stretched by exactly that much. The host test
    // `bullet-threading-example.test.ts` compares the two.
    // `--bt-build` is a version marker with no visual effect: it is the only way to
    // tell from a running app WHICH build of this plugin is live, and a reload that
    // silently kept the old module looks exactly like a rule that did not apply.
    // Read it with
    //   getComputedStyle(document.querySelector(".tiptap")).getPropertyValue("--bt-build")
    `.tiptap{--bt-build:"${STYLE_REVISION}";--bt-color:${settings.color};` +
      `--bt-width:${settings.lineWidth}px;--bt-gap:0.15em;--bt-image-gap:0.5em;` +
      `--bt-radius:0.6em}`,

    // The elbow: one box carrying a left and a bottom border, curved where they meet.
    // Only on an item that is itself inside a list item — a top-level item has no parent
    // rail to descend from, and the stroke would hang in the left margin.
    // It spans from the rail to 0.5em short of the item's edge — the centre of a bullet's
    // column, under the ring that masks it — so it is as wide as the rail is far from there.
    `${root} li li.${THREAD_CLASS}::after{` +
      `position:absolute;` +
      `z-index:1;` +
      `left:${railX};` +
      `margin-left:${centreOnRail};` +
      `top:calc(-1 * var(--bt-gap));` +
      `width:calc(var(--list-gutter, 1.4em) - 0.5em - var(--list-guide-left, -1em));` +
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
      `z-index:1;` +
      `left:${railX};` +
      `margin-left:${centreOnRail};` +
      `top:calc(-1 * var(--bt-gap));` +
      `bottom:0;` +
      `border-left:${stroke};` +
      `pointer-events:none;` +
      `content:""}`,

    // An image at an item's EDGE moves the item's gap. Its margin collapses through the
    // item's box, so the gap to the neighbour on that side is `--bt-image-gap`, not
    // `--bt-gap`, and a stroke that bridged `--bt-gap` left a seam of the difference — a
    // few pixels of the grey guide showing through, seen in the app on both sides.
    //
    // Below a sibling whose LAST block is an image: the sibling's segment reaches down the
    // difference, to where the next item's climb begins.
    `${childItem(`:not(.${THREAD_CLASS})${imageAt(":last-child")}`)}{` +
      `bottom:calc(var(--bt-gap) - var(--bt-image-gap))}`,
    // Above an item whose FIRST block is an image (`- ![](a.png)` reads that way): its
    // stroke climbs the whole gap. The elbow is one box from that gap to the marker, so it
    // grows by as much as its top moves.
    `${childItem(`:not(.${THREAD_CLASS})${imageAt(firstBlock)}`)}{` +
      `top:calc(-1 * var(--bt-image-gap))}`,
    `${root} li li.${THREAD_CLASS}${imageAt(firstBlock)}::after{` +
      `top:calc(-1 * var(--bt-image-gap));` +
      `height:calc(var(--bt-image-gap) + var(--editor-line-height, 1.75) * 0.5em + ` +
      `var(--bt-width) / 2)}`,

    // ...and no further. The thread stops where the caret is; siblings below it are not
    // on the way to anywhere.
    `${childItem(`.${THREAD_CLASS} ~ li`)}{border-color:transparent}`,
    // Nor is a whole sub-list that comes after the one holding the next rung — an item can
    // hold two, and the segments above are drawn in every list directly in the item. A
    // list BEFORE the rung's keeps them: the thread runs past it on its way down.
    //
    // ‼️ The rung's list is the one the plugin marks (`threading.ts`). 2.1.2 found it here
    // instead, with a `:has(> li.bt-thread)` on the list — in the middle of the selector,
    // before the `~` — and in the app's WebKit (debug build, 2026-11-14) that one rule, in
    // both its forms, made a caret move on a 3000-item text list take 15 ms where 2.1.1 took
    // 5, and 6 without it; Enter took 26 ms where 2.1.1 took 23. Chromium, measured on a
    // 3000-item list with 2000 images only, showed no cost from any `:has()` in the sheet.
    // Every `:has()` in the stylesheet this function builds sits in the selector's last
    // compound, on the element the rule styles; on the same text list the 26 of them
    // measured 6 ms against 5 with no `:has()` at all.
    // `:is(ul, ol)` in front of the class keeps this rule more specific than the sibling
    // segments it overrides, as the `:has()` form was, so their order does not decide it.
    [
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > :is(ul, ol).${RUNG_LIST_CLASS} ~ :is(ul, ol) > li::after`,
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol).${RUNG_LIST_CLASS} ~ :is(ul, ol) > li::after`,
    ].join(",\n") + `{border-color:transparent}`,

    // From the PARENT's own marker down to its first child, so the thread leaves a bullet
    // rather than appearing out of the gap below it. Each paragraph draws its own box:
    // `top`/`bottom` span exactly its height, so under a parent that wraps, the stroke
    // runs from the first line's centre to the last line's bottom however many lines
    // there are. The first child's segment starts one `--bt-gap` above that child, which
    // is where the last paragraph ends — `li p` has no margin in lists.css, so the
    // collapsed margin between them is the child's own — and consecutive paragraphs meet
    // for the same reason.
    //
    // ‼️ This used to be the first child reaching UP by a constant — one `--bt-gap` plus
    // half a line-box — which holds only while the parent's text is one line-box tall.
    // The child sits one `--bt-gap` below the parent's LAST line-box, so under a parent
    // that wrapped, the thread started a whole line-box short of the marker per extra line
    // (measured in a browser: 31.5px at 18px × 1.75, one wrap). No constant can be right,
    // and the child cannot see the parent's height.
    //
    // `position: relative` is what makes the paragraph the stroke's containing block —
    // without it that is the item, and `bottom: 0` would run to the end of the sub-list.
    // It is set only while the item is threaded, and a containing block moves only what is
    // absolutely positioned against something further up. Read in Baram's stylesheets
    // when this was written (`src/styles` and the KaTeX sheet it imports), what a
    // paragraph can hold that is absolutely positioned is a footnote's tooltip, a block
    // reference's resize handle and its label, and KaTeX's own parts — each inside a
    // positioned box nearer than the paragraph (`.footnote-ref`, the reference's area
    // preview, `.katex`) — while the popovers and suggestion menus are mounted on
    // `<body>`. A theme or another plugin is outside that reading.
    //
    // An IMAGE between the text and the sub-list draws its own box the same way, from the
    // `node-image` wrapper. Everything the image view positions absolutely — resize
    // handles, size label, toolbar, caption — sits inside its `figure`, which is itself
    // `position: relative` (editor/media.css), and the full-size viewer is a portal on
    // `<body>`, so making the wrapper a containing block moves none of them. The image's
    // margin is outside that box, so its stroke climbs the margin above it — the block
    // above is a paragraph, which has none, or another image, whose margin collapses into
    // this one — and reaches down through the margin below it when nothing below climbs
    // it: all of it above a paragraph, all but the `--bt-gap` the first child climbs above
    // the sub-list.
    //
    // Any other block between the text and the sub-list (a code block, a table, a video)
    // still leaves a gap over that block: its margins are not ones this file names, and a
    // box that clips its overflow would clip a stroke hanging outside it.
    //
    // ‼️ `z-index:1` because the host's guide runs beside these blocks too. lists.css hangs
    // an item's own guide from the item, from its first line down, and draws it as the
    // sub-list's `::before` — which comes AFTER these blocks in the tree, so at equal
    // z-index it painted over the stroke: an opaque line ~1.4px wide down the middle of a
    // 2px one, seen in the app as a thin, washed-out stretch beside the parent's text and
    // its image. The child items' strokes (the elbow and the sibling segments above) sit at
    // 1 for the same reason: they come after their own list's guide, but an item can hold a
    // SECOND sub-list, whose guide is hung from the item too and comes after all of them.
    `${leadingBlock(leading, "")}{position:relative}`,
    `${leadingBlock(leading, "::after")}{` +
      `position:absolute;` +
      `z-index:1;` +
      `left:${leadRailX};` +
      `margin-left:${centreOnRail};` +
      `top:0;` +
      `bottom:0;` +
      `border-left:${stroke};` +
      `pointer-events:none;` +
      `content:""}`,
    `${leadingBlock(".node-image", "::after")}{` +
      `top:calc(-1 * var(--bt-image-gap))}`,
    `${leadingBlock(".node-image:has(+ p)", "::after")}{` +
      `bottom:calc(-1 * var(--bt-image-gap))}`,
    `${leadingBlock(`.node-image${nextIsRungList}`, "::after")}{` +
      `bottom:calc(var(--bt-gap) - var(--bt-image-gap))}`,
    // The item's FIRST block starts at the marker's centre — the expression the markers
    // use to centre themselves on the first line box. Usually a paragraph, but an item
    // written `- ![](a.png)` starts with the image, whose margin collapses through the
    // item's top so its box begins at the item's top all the same. (Not `p:first-of-type`,
    // which in such an item is a paragraph below the image.)
    `${leadingBlock(`${leading}${firstBlock}`, "::after")}{` +
      `top:calc(var(--editor-line-height, 1.75) * 0.5em)}`,

    // The bullets along the thread become rings, which is what makes the stroke read as
    // ending in something rather than stopping near it. The centre is filled with the
    // editor's background, so the segment running underneath is masked by the ring
    // itself and no arithmetic is needed to stop the line short of the marker —
    // `z-index` is only needed because `::after` would otherwise paint over `::before`,
    // and it is 2 because the parent's own strokes, which start under this ring at the
    // marker's centre, sit at 1.
    // Ordered markers are text and task items draw no marker at all (`content: none`),
    // so both fall through to the colour rule below.
    `${root} ul > li.${THREAD_CLASS}::before{` +
      `z-index:2;` +
      `background:var(--color-editor-bg);` +
      `box-shadow:0 0 0 var(--bt-width) var(--bt-color)}`,
    // A task item's marker is its checkbox, a `<button>` the host positions absolutely in
    // the same column and fills with its own ground (editor/task-checkbox.css). It masks
    // the strokes the way a ring does once it is above them — the task parent's own stroke
    // starts at its centre, and the elbow ends there.
    `${root} li[data-type="taskItem"].${THREAD_CLASS} > .task-checkbox{z-index:2}`,

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
    //
    // ‼️ "Without moving the number" is a claim about the HOST, and the host is what makes
    // it true: `editor/lists.css` gives the ordered marker `box-sizing: content-box` and
    // says why, naming this rule. Under the app-wide `border-box` the same padding comes
    // out of the glyph column that the marker's `min-width` floor reserved, and every
    // number on the threaded branch shifts right by this length (measured at 4.83px with
    // an 18px editor font). If a future host drops that declaration, mask with a
    // `::after` overlay instead of padding rather than restoring it here.
    //
    // `z-index:2`, as the ring's: the parent's own stroke starts under the number, at 1.
    `${root} ol > li.${THREAD_CLASS}::before{` +
      `z-index:2;` +
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
