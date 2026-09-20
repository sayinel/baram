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

// src/threading.ts
var THREAD_CLASS = "bt-thread";
var CURSOR_CLASS = "bt-thread-cursor";
function threadDecorations(state, pm) {
  const rungs = ancestorRungs(
    state.selection.$head
  );
  if (rungs.length === 0) return pm.DecorationSet.empty;
  const last = rungs.length - 1;
  return pm.DecorationSet.create(
    state.doc,
    rungs.map(
      (rung, i) => pm.Decoration.node(rung.from, rung.to, {
        class: i === last ? `${THREAD_CLASS} ${CURSOR_CLASS}` : THREAD_CLASS
      })
    )
  );
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
  color: "var(--color-accent-default)",
  lineWidth: 2,
  showElbow: true
};
var SAFE_COLOR = /^[\w#(),.%\s-]{1,64}$/;
var STYLE_REVISION = "4";
var MIN_WIDTH = 0.5;
var MAX_WIDTH = 8;
function resolveSettings(raw) {
  return {
    color: resolveColor(raw.color),
    lineWidth: resolveWidth(raw.lineWidth),
    showElbow: typeof raw.showElbow === "boolean" ? raw.showElbow : DEFAULT_SETTINGS.showElbow
  };
}
function buildCss(settings) {
  const railX = `calc(-1 * (var(--list-gutter, 1.4em) + 1em))`;
  const centreOnRail = `calc(var(--bt-width) / -2)`;
  const stroke = `var(--bt-width) solid var(--bt-color)`;
  const reachUp = `calc(-1 * (var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em))`;
  const firstChild = (suffix) => childItem(`${suffix}:first-child`);
  const childItem = (suffix) => [
    `.tiptap li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > :is(ul, ol) > li${suffix}::after`,
    `.tiptap li.${THREAD_CLASS}:not(.${CURSOR_CLASS}) > div > :is(ul, ol) > li${suffix}::after`
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
    `.tiptap{--bt-build:"${STYLE_REVISION}";--bt-color:${settings.color};--bt-width:${settings.lineWidth}px;--bt-gap:0.15em;--bt-radius:0.6em}`,
    // The elbow: one box carrying a left and a bottom border, curved where they meet.
    // Only on an item that is itself inside a list item — a top-level item has no parent
    // rail to descend from, and the stroke would hang in the left margin.
    `.tiptap li li.${THREAD_CLASS}::after{position:absolute;left:${railX};margin-left:${centreOnRail};top:calc(-1 * var(--bt-gap));width:calc(var(--list-gutter, 1.4em) + 0.5em);height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em + var(--bt-width) / 2);border-left:${stroke};` + (settings.showElbow ? `border-bottom:${stroke};border-bottom-left-radius:var(--bt-radius);` : ``) + `pointer-events:none;content:""}`,
    // The siblings above the threaded item, so the thread reaches it unbroken. Each
    // segment starts one collapsed margin high to close the gap to the item above.
    `${childItem(`:not(.${THREAD_CLASS})`)}{position:absolute;left:${railX};margin-left:${centreOnRail};top:calc(-1 * var(--bt-gap));bottom:0;border-left:${stroke};pointer-events:none;content:""}`,
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
    `${firstChild(`.${THREAD_CLASS}`)}{top:${reachUp};height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 1em + var(--bt-width) / 2)}`,
    // The bullets along the thread become rings, which is what makes the stroke read as
    // ending in something rather than stopping near it. The centre is filled with the
    // editor's background, so the segment running underneath is masked by the ring
    // itself and no arithmetic is needed to stop the line short of the marker —
    // `z-index` is only needed because `::after` would otherwise paint over `::before`.
    // Ordered markers are text and task items draw no marker at all (`content: none`),
    // so both fall through to the colour rule below.
    `.tiptap ul > li.${THREAD_CLASS}::before{z-index:1;background:var(--color-editor-bg);box-shadow:0 0 0 var(--bt-width) var(--bt-color)}`,
    // Everything else on the thread that paints with `currentcolor` — ordered numbers,
    // and the bullet's fallback if the rule above is ever overridden.
    `.tiptap li.${THREAD_CLASS}::before{color:var(--bt-color)}`,
    // The end of the thread is filled rather than hollow, with a soft halo: in a deep
    // outline the stroke alone says which BRANCH you are on, not which item.
    `.tiptap ul > li.${CURSOR_CLASS}::before{background:var(--bt-color);box-shadow:0 0 0 var(--bt-width) var(--bt-color),0 0 0 calc(var(--bt-width) * 3) color-mix(in srgb, var(--bt-color) 25%, transparent)}`,
    // ...and the ordered-list equivalent, where there is no dot to fill. A box around
    // the number reads as a form field; a glow on the glyph itself is the same gesture
    // as the bullet's halo, so `text-shadow` rather than `box-shadow` — the latter would
    // outline the marker's rectangular box.
    `.tiptap ol > li.${CURSOR_CLASS}::before{color:var(--bt-color);font-weight:700;text-shadow:0 0 calc(var(--bt-width) * 2.5) color-mix(in srgb, var(--bt-color) 55%, transparent)}`,
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
    `.tiptap ol > li.${THREAD_CLASS}::before{z-index:1;background:var(--color-editor-bg);padding-left:0.3em}`
  ].join("\n");
}
function resolveColor(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.color;
  const trimmed = value.trim();
  return trimmed && SAFE_COLOR.test(trimmed) ? trimmed : DEFAULT_SETTINGS.color;
}
function resolveWidth(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.lineWidth;
  }
  return value < MIN_WIDTH || value > MAX_WIDTH ? DEFAULT_SETTINGS.lineWidth : value;
}

// src/index.ts
var style;
function activate(context) {
  const raw = context.settings?.getAll() ?? {};
  const settings = resolveSettings(raw);
  style = context.ui?.addStyle(buildCss(settings));
}
function deactivate() {
  style?.dispose();
  style = void 0;
}
var Threading = createThreadingPlugin;
export {
  DEFAULT_SETTINGS,
  Threading,
  activate,
  deactivate
};
