// src/thread.ts
var LIST_ITEM_TYPES = ["listItem", "taskItem"];
function ancestorRungs($pos) {
  const rungs = [];
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const name = $pos.node(depth).type.name;
    if (LIST_ITEM_TYPES.includes(name)) {
      rungs.push({ from: $pos.before(depth), depth, to: $pos.after(depth) });
    }
  }
  return rungs;
}
function rungLists($pos, rungs) {
  return rungs.filter((rung) => rung.depth > 1).map((rung) => ({
    from: $pos.before(rung.depth - 1),
    to: $pos.after(rung.depth - 1)
  }));
}

// src/threading.ts
var THREAD_CLASS = "bt-thread";
var CURSOR_CLASS = "bt-thread-cursor";
var RUNG_LIST_CLASS = "bt-rung-list";
function threadDecorations(state, pm) {
  const $head = state.selection.$head;
  const rungs = ancestorRungs($head);
  if (rungs.length === 0) return pm.DecorationSet.empty;
  const last = rungs.length - 1;
  return pm.DecorationSet.create(state.doc, [
    ...rungs.map(
      (rung, i) => pm.Decoration.node(rung.from, rung.to, {
        class: i === last ? `${THREAD_CLASS} ${CURSOR_CLASS}` : THREAD_CLASS
      })
    ),
    ...rungLists($head, rungs).map(
      (list) => pm.Decoration.node(list.from, list.to, { class: RUNG_LIST_CLASS })
    )
  ]);
}
function createThreadingPlugin(ctx) {
  return new ctx.pm.Plugin({
    key: ctx.key,
    props: {
      decorations: (state) => threadDecorations(state, ctx.pm)
    }
  });
}

// src/css.ts
var DEFAULT_SETTINGS = {
  caretMarker: "halo",
  color: "var(--color-accent-default)",
  lineWidth: 2,
  onlyWhenFocused: false,
  showElbow: true
};
var CARET_MARKERS = ["filled", "halo", "none"];
var SAFE_COLOR = /^[\w#(),.%\s-]{1,64}$/;
var STYLE_REVISION = "9";
var MIN_WIDTH = 0.5;
var MAX_WIDTH = 8;
function resolveSettings(raw) {
  return {
    caretMarker: resolveOneOf(
      raw.caretMarker,
      CARET_MARKERS,
      DEFAULT_SETTINGS.caretMarker
    ),
    color: resolveColor(raw.color),
    lineWidth: resolveWidth(raw.lineWidth),
    onlyWhenFocused: resolveBoolean(
      raw.onlyWhenFocused,
      DEFAULT_SETTINGS.onlyWhenFocused
    ),
    showElbow: resolveBoolean(raw.showElbow, DEFAULT_SETTINGS.showElbow)
  };
}
function buildCss(settings) {
  const root = settings.onlyWhenFocused ? `.tiptap.ProseMirror-focused` : `.tiptap`;
  const railX = `calc(var(--list-guide-left, -1em) - var(--list-gutter, 1.4em))`;
  const centreOnRail = `calc(var(--bt-width) / -2)`;
  const stroke = `var(--bt-width) solid var(--bt-color)`;
  const childItem = (suffix) => [
    `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > :is(ul, ol) > li${suffix}::after`,
    `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol) > li${suffix}::after`
  ].join(",\n");
  const leadingBlock = (block, suffix) => [
    `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > ${block}:has(~ :is(ul, ol) > li.${THREAD_CLASS})${suffix}`,
    `${root} li[data-type="taskItem"].${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > ${block}:has(~ :is(ul, ol) > li.${THREAD_CLASS})${suffix}`
  ].join(",\n");
  const leading = ":is(p, .node-image)";
  const nextIsRungList = `:has(+ :is(ul, ol) > li.${THREAD_CLASS})`;
  const firstBlock = ":is(:first-child, .fold-arrow:first-child + *)";
  const imageAt = (position) => `:is(:has(> .node-image${position}), [data-type="taskItem"]:has(> div > .node-image${position}))`;
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
    `.tiptap{--bt-build:"${STYLE_REVISION}";--bt-color:${settings.color};--bt-width:${settings.lineWidth}px;--bt-gap:0.15em;--bt-image-gap:0.5em;--bt-radius:0.6em}`,
    // The elbow: one box carrying a left and a bottom border, curved where they meet.
    // Only on an item that is itself inside a list item — a top-level item has no parent
    // rail to descend from, and the stroke would hang in the left margin.
    // It spans from the rail to 0.5em short of the item's edge — the centre of a bullet's
    // column, under the ring that masks it — so it is as wide as the rail is far from there.
    `${root} li li.${THREAD_CLASS}::after{position:absolute;z-index:1;left:${railX};margin-left:${centreOnRail};top:calc(-1 * var(--bt-gap));width:calc(var(--list-gutter, 1.4em) - 0.5em - var(--list-guide-left, -1em));height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em + var(--bt-width) / 2);border-left:${stroke};` + (settings.showElbow ? `border-bottom:${stroke};border-bottom-left-radius:var(--bt-radius);` : ``) + `pointer-events:none;content:""}`,
    // The siblings above the threaded item, so the thread reaches it unbroken. Each
    // segment starts one collapsed margin high to close the gap to the item above.
    `${childItem(`:not(.${THREAD_CLASS})`)}{position:absolute;z-index:1;left:${railX};margin-left:${centreOnRail};top:calc(-1 * var(--bt-gap));bottom:0;border-left:${stroke};pointer-events:none;content:""}`,
    // An image at an item's EDGE moves the item's gap. Its margin collapses through the
    // item's box, so the gap to the neighbour on that side is `--bt-image-gap`, not
    // `--bt-gap`, and a stroke that bridged `--bt-gap` left a seam of the difference — a
    // few pixels of the grey guide showing through, seen in the app on both sides.
    //
    // Below a sibling whose LAST block is an image: the sibling's segment reaches down the
    // difference, to where the next item's climb begins.
    `${childItem(`:not(.${THREAD_CLASS})${imageAt(":last-child")}`)}{bottom:calc(var(--bt-gap) - var(--bt-image-gap))}`,
    // Above an item whose FIRST block is an image (`- ![](a.png)` reads that way): its
    // stroke climbs the whole gap. The elbow is one box from that gap to the marker, so it
    // grows by as much as its top moves.
    `${childItem(`:not(.${THREAD_CLASS})${imageAt(firstBlock)}`)}{top:calc(-1 * var(--bt-image-gap))}`,
    `${root} li li.${THREAD_CLASS}${imageAt(firstBlock)}::after{top:calc(-1 * var(--bt-image-gap));height:calc(var(--bt-image-gap) + var(--editor-line-height, 1.75) * 0.5em + var(--bt-width) / 2)}`,
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
      `${root} li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol).${RUNG_LIST_CLASS} ~ :is(ul, ol) > li::after`
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
    `${leadingBlock(leading, "::after")}{position:absolute;z-index:1;left:${leadRailX};margin-left:${centreOnRail};top:0;bottom:0;border-left:${stroke};pointer-events:none;content:""}`,
    `${leadingBlock(".node-image", "::after")}{top:calc(-1 * var(--bt-image-gap))}`,
    `${leadingBlock(".node-image:has(+ p)", "::after")}{bottom:calc(-1 * var(--bt-image-gap))}`,
    `${leadingBlock(`.node-image${nextIsRungList}`, "::after")}{bottom:calc(var(--bt-gap) - var(--bt-image-gap))}`,
    // The item's FIRST block starts at the marker's centre — the expression the markers
    // use to centre themselves on the first line box. Usually a paragraph, but an item
    // written `- ![](a.png)` starts with the image, whose margin collapses through the
    // item's top so its box begins at the item's top all the same. (Not `p:first-of-type`,
    // which in such an item is a paragraph below the image.)
    `${leadingBlock(`${leading}${firstBlock}`, "::after")}{top:calc(var(--editor-line-height, 1.75) * 0.5em)}`,
    // The bullets along the thread become rings, which is what makes the stroke read as
    // ending in something rather than stopping near it. The centre is filled with the
    // editor's background, so the segment running underneath is masked by the ring
    // itself and no arithmetic is needed to stop the line short of the marker —
    // `z-index` is only needed because `::after` would otherwise paint over `::before`,
    // and it is 2 because the parent's own strokes, which start under this ring at the
    // marker's centre, sit at 1.
    // Ordered markers are text and task items draw no marker at all (`content: none`),
    // so both fall through to the colour rule below.
    `${root} ul > li.${THREAD_CLASS}::before{z-index:2;background:var(--color-editor-bg);box-shadow:0 0 0 var(--bt-width) var(--bt-color)}`,
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
    ...settings.caretMarker === "none" ? [] : [
      `${root} ul > li.${CURSOR_CLASS}::before{background:var(--bt-color);box-shadow:0 0 0 var(--bt-width) var(--bt-color)` + (settings.caretMarker === "halo" ? `,0 0 0 calc(var(--bt-width) * 3) color-mix(in srgb, var(--bt-color) 25%, transparent)` : ``) + `}`,
      // ...and the ordered-list equivalent, where there is no dot to fill. A box around
      // the number reads as a form field; a glow on the glyph itself is the same gesture
      // as the bullet's halo, so `text-shadow` rather than `box-shadow` — the latter
      // would outline the marker's rectangular box.
      `${root} ol > li.${CURSOR_CLASS}::before{color:var(--bt-color);font-weight:700;` + (settings.caretMarker === "halo" ? `text-shadow:0 0 calc(var(--bt-width) * 2.5) color-mix(in srgb, var(--bt-color) 55%, transparent);` : ``) + `}`
    ],
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
    `${root} ol > li.${THREAD_CLASS}::before{z-index:2;background:var(--color-editor-bg);padding-left:0.3em}`
  ].join("\n");
}
function resolveBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function resolveColor(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.color;
  const trimmed = value.trim();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : DEFAULT_SETTINGS.color;
}
function resolveOneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
function resolveWidth(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.lineWidth;
  }
  return value < MIN_WIDTH || value > MAX_WIDTH ? DEFAULT_SETTINGS.lineWidth : value;
}

// src/index.ts
var style;
var watching;
function activate(context) {
  inject(context);
  try {
    watching = context.events?.on("settings:changed", () => inject(context));
  } catch {
    watching = void 0;
  }
}
function deactivate() {
  style?.dispose();
  style = void 0;
  watching?.dispose();
  watching = void 0;
}
var Threading = createThreadingPlugin;
function inject(context) {
  const raw = context.settings?.getAll() ?? {};
  const css = buildCss(resolveSettings(raw));
  style?.dispose();
  style = context.ui?.addStyle(css);
}
export {
  DEFAULT_SETTINGS,
  Threading,
  activate,
  deactivate
};
