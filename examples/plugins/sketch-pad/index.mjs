// §392 spec 0071 §9 — Sketch Pad, the editable file viewer example: draw lines with the pointer
// on a `.strokes` file. A trusted plugin (`viewer` + `files`) written as one dependency-free ESM
// file with no build step.
//
// What it shows:
// - `markChanged()` on every pointer move — nothing is serialized until Baram reads;
// - `getText` is `JSON.stringify` of the model and reads no layout (Baram can call it after the
//   element has left the document);
// - `onUpdate` redraws only when the text differs from the model's own serialization — another
//   writer, a reload, a resolved conflict — and only resizes on a zoom that carries the same text;
// - screen state (the pen width) kept per tab with `ctx.edit.tabId`, so it survives the remount a
//   tab switch causes;
// - without `ctx.edit` (an app before §392, or a file editing is not open for) the same code
//   draws the file from disk and never edits;
// - undo is the viewer's own: Mod+Z removes the last stroke.
//
// The file: { "version": 1, "strokes": [[x0, y0, x1, y1, …], …] }, coordinates in drawing units
// on an 800 × 600 sheet before zoom. Text that is not that shape is shown read-only and never
// replaced; an empty file is an empty drawing.

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 800;
const HEIGHT = 600;
const NOT_A_DRAWING =
  "This file is not a Sketch Pad drawing. It is shown read-only and will not be changed.";
const LOAD_FAILED = "Could not load the file.";
const PEN_WIDTHS = [1, 3, 6];
const DEFAULT_PEN = 3;

/** Pen width by tab id — screen state, not part of the file. */
const penByTab = new Map();
/** One view per mounted element. */
const views = new WeakMap();

const STYLE = `
.sketch-pad { display: flex; flex-direction: column; gap: 8px; padding: 16px; outline: none; }
.sketch-pad-toolbar { display: flex; gap: 4px; }
.sketch-pad-toolbar button[aria-pressed="true"] { font-weight: 600; }
.sketch-pad-notice { margin: 0; color: var(--color-status-danger); }
.sketch-pad-canvas {
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-default);
  touch-action: none;
}
.sketch-pad-canvas polyline {
  fill: none;
  stroke: var(--color-text-default);
  stroke-linecap: round;
  stroke-linejoin: round;
}
`;

/** The model for `text`, or null when it is not a Sketch Pad drawing. */
function parse(text) {
  if (text.trim() === "") return { strokes: [], version: 1 };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.version !== 1 || !Array.isArray(data.strokes)) return null;
  const valid = data.strokes.every(
    (stroke) =>
      Array.isArray(stroke) &&
      stroke.length % 2 === 0 &&
      stroke.every((n) => typeof n === "number" && Number.isFinite(n)),
  );
  return valid
    ? { strokes: data.strokes.map((s) => [...s]), version: 1 }
    : null;
}

function serialize(model) {
  return JSON.stringify({ version: 1, strokes: model.strokes });
}

/** What the viewer would hand back now: the drawing, or the read-only text untouched. */
function currentText(view) {
  return view.readOnly ? view.source : serialize(view.model);
}

function penOf(view) {
  return view.edit
    ? (penByTab.get(view.edit.tabId) ?? DEFAULT_PEN)
    : DEFAULT_PEN;
}

function pointsOf(stroke) {
  const pairs = [];
  for (let i = 0; i < stroke.length; i += 2)
    pairs.push(`${stroke[i]},${stroke[i + 1]}`);
  return pairs.join(" ");
}

/** Size the sheet for the zoom. The viewBox scales the strokes; nothing is redrawn. */
function resize(view) {
  view.svg.setAttribute("width", String(WIDTH * view.ctx.zoomLevel));
  view.svg.setAttribute("height", String(HEIGHT * view.ctx.zoomLevel));
}

function draw(view) {
  resize(view);
  const pen = String(penOf(view));
  view.svg.replaceChildren(
    ...view.model.strokes.map((stroke) => {
      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("points", pointsOf(stroke));
      line.setAttribute("stroke-width", pen);
      return line;
    }),
  );
  view.notice.textContent = view.loadFailed ? LOAD_FAILED : NOT_A_DRAWING;
  view.notice.hidden = !view.readOnly;
  for (const button of view.toolbar.querySelectorAll("button")) {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.pen) === penOf(view)),
    );
  }
}

/** Show `text`: a drawing when it parses, read-only otherwise. */
function load(view, text) {
  view.loadFailed = false;
  const model = parse(text);
  view.readOnly = model === null;
  view.model = model ?? { strokes: [], version: 1 };
  view.source = text;
  draw(view);
}

function fetchAndLoad(el, view, url) {
  fetch(url)
    .then((response) => response.text())
    .then((text) => {
      if (views.get(el) === view) load(view, text);
    })
    .catch(() => {
      if (views.get(el) !== view) return;
      view.readOnly = true;
      view.loadFailed = true;
      draw(view);
    });
}

function toDrawing(view, event) {
  const rect = view.svg.getBoundingClientRect();
  const zoom = view.ctx.zoomLevel;
  const x = Math.round((event.clientX - rect.left) / zoom);
  const y = Math.round((event.clientY - rect.top) / zoom);
  return [Math.min(Math.max(x, 0), WIDTH), Math.min(Math.max(y, 0), HEIGHT)];
}

function startStroke(view, event) {
  if (!view.edit || view.readOnly || event.button !== 0) return;
  event.preventDefault();
  // preventDefault on pointerdown can stop the browser moving focus here, and Mod+Z only
  // reaches the viewer while its root has focus — so take focus explicitly.
  view.svg.closest(".sketch-pad")?.focus({ preventScroll: true });
  try {
    view.svg.setPointerCapture(event.pointerId);
  } catch {
    // Not every pointer event carries an id that can be captured.
  }
  view.current = [...toDrawing(view, event)];
  view.model.strokes.push(view.current);
  draw(view);
  view.edit.markChanged();
}

function extendStroke(view, event) {
  if (!view.current) return;
  view.current.push(...toDrawing(view, event));
  draw(view);
  view.edit.markChanged();
}

function endStroke(view) {
  view.current = null;
}

function undo(view, event) {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z")
    return;
  if (!view.edit || view.readOnly || view.model.strokes.length === 0) return;
  event.preventDefault();
  view.model.strokes.pop();
  draw(view);
  view.edit.markChanged();
}

function onMount(el, ctx) {
  const root = document.createElement("div");
  root.className = "sketch-pad";
  // Focusable, so Mod+Z reaches the viewer once the user clicks it.
  root.tabIndex = 0;
  const toolbar = document.createElement("div");
  toolbar.className = "sketch-pad-toolbar";
  toolbar.hidden = !ctx.edit;
  const notice = document.createElement("p");
  notice.className = "sketch-pad-notice";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.classList.add("sketch-pad-canvas");
  root.append(toolbar, notice, svg);
  el.append(root);

  const view = {
    ctx,
    current: null,
    edit: ctx.edit,
    loadFailed: false,
    model: { strokes: [], version: 1 },
    notice,
    readOnly: false,
    source: "",
    svg,
    toolbar,
  };
  views.set(el, view);

  for (const width of PEN_WIDTHS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pen = String(width);
    button.textContent = `${width}px`;
    button.addEventListener("click", () => {
      if (view.edit) penByTab.set(view.edit.tabId, width);
      draw(view);
    });
    toolbar.append(button);
  }
  svg.addEventListener("pointerdown", (event) => startStroke(view, event));
  svg.addEventListener("pointermove", (event) => extendStroke(view, event));
  svg.addEventListener("pointerup", () => endStroke(view));
  svg.addEventListener("pointercancel", () => endStroke(view));
  root.addEventListener("keydown", (event) => undo(view, event));

  if (ctx.edit) {
    load(view, ctx.edit.text);
  } else {
    draw(view);
    fetchAndLoad(el, view, ctx.assetUrl);
  }
}

function onUpdate(el, ctx) {
  const view = views.get(el);
  if (!view) return;
  const previous = view.ctx;
  view.ctx = ctx;
  if (ctx.edit) {
    view.edit = ctx.edit;
    // Another writer, a reload or a resolved conflict — or a zoom step carrying our own text.
    if (ctx.edit.text !== currentText(view)) {
      load(view, ctx.edit.text);
      return;
    }
  } else if (ctx.assetUrl !== previous.assetUrl) {
    fetchAndLoad(el, view, ctx.assetUrl);
  }
  if (ctx.zoomLevel !== previous.zoomLevel) resize(view);
}

function onUnmount(el) {
  views.delete(el);
}

function getText(el) {
  const view = views.get(el);
  if (!view)
    throw new Error("Sketch Pad: getText for an element it has not mounted");
  return currentText(view);
}

export function activate(ctx) {
  ctx.ui.addStyle(STYLE);
  ctx.ui.registerFileViewer({
    editable: true,
    extensions: ["strokes"],
    getText,
    id: "pad",
    onMount,
    onUnmount,
    onUpdate,
  });
}
