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
  lineWidth: 1.5,
  showElbow: true
};
var SAFE_COLOR = /^[\w#(),.%\s-]{1,64}$/;
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
  const stroke = `var(--bt-width) solid var(--bt-color)`;
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
    `.tiptap{--bt-color:${settings.color};--bt-width:${settings.lineWidth}px;--bt-gap:0.15em;--bt-radius:0.45em}`,
    // The elbow: one box carrying a left and a bottom border, curved where they meet.
    // Only on an item that is itself inside a list item — a top-level item has no parent
    // rail to descend from, and the stroke would hang in the left margin.
    `.tiptap li li.${THREAD_CLASS}::after{position:absolute;left:${railX};top:calc(-1 * var(--bt-gap));width:calc(var(--list-gutter, 1.4em) + 0.5em);height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em);border-left:${stroke};` + (settings.showElbow ? `border-bottom:${stroke};border-bottom-left-radius:var(--bt-radius);` : ``) + `pointer-events:none;content:""}`,
    // The siblings above the threaded item, so the thread reaches it unbroken. Each
    // segment starts one collapsed margin high to close the gap to the item above.
    `${childItem(`:not(.${THREAD_CLASS})`)}{position:absolute;left:${railX};top:calc(-1 * var(--bt-gap));bottom:0;border-left:${stroke};pointer-events:none;content:""}`,
    // ...and no further. The thread stops where the caret is; siblings below it are not
    // on the way to anywhere.
    `${childItem(`.${THREAD_CLASS} ~ li`)}{border-color:transparent}`,
    // The bullets along the thread. The markers paint with `currentcolor`, so setting
    // `color` is all it takes.
    `.tiptap li.${THREAD_CLASS}::before{color:var(--bt-color)}`,
    // The one at the end carries a ring as well: in a deep outline the thread alone says
    // which BRANCH you are on, not which item.
    `.tiptap li.${CURSOR_CLASS}::before{color:var(--bt-color);box-shadow:0 0 0 var(--bt-width) var(--bt-color)}`
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
