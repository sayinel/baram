---
title: "Editable file viewers"
---

A file viewer (`context.ui.registerFileViewer`, see
[Context: UI and Shadow-DOM isolation](/en/docs/plugin-dev/context-ui-and-shadow-dom/)) can also
**change** the file it shows — a drawing, a board or a diagram kept as text. Baram keeps the
text: the open tab owns it, and saving, the unsaved dot, auto-save, outside changes and the quit
prompt work exactly as they do for a file edited as source. Your viewer does two things: it says
that the document changed, and it hands its text back when Baram asks for it.

Editable viewers are a **trusted-tier** API — a sandboxed plugin has no viewer surface.

## Registering one

```typescript
ctx.ui.registerFileViewer({
  id: "board",
  extensions: ["board"],
  editable: true,
  getText: (el) => serialize(boardOf(el)),
  onMount(el, viewerCtx) {
    const edit = viewerCtx.edit;
    if (!edit) return drawReadOnly(el, viewerCtx.assetUrl);
    showBoard(el, parse(edit.text), () => edit.markChanged());
  },
  onUpdate(el, viewerCtx) {
    const edit = viewerCtx.edit;
    if (edit && edit.text !== serialize(boardOf(el))) {
      showBoard(el, parse(edit.text), () => edit.markChanged());
    }
  },
  onUnmount(el) {
    forget(el);
  },
});
```

`editable: true` needs two things, or `registerFileViewer` throws inside `activate` and the
plugin does not load:

- a `getText(el)` function, and
- the `files` capability (`files:readonly` is not enough). Asking for `files` is how the install
  prompt tells the user that the plugin can change files. It is consent, not a sandbox: a
  trusted plugin runs with the app's privileges either way.

## When editing is on

`onMount` receives `ctx.edit` only when all of these hold. Otherwise the same viewer is mounted
without it and should only draw.

- The viewer was registered with `editable: true`.
- The file is text Baram can write back: not markdown, not HTML (Baram's own preview shows HTML),
  not a raster image or a PDF (an `.svg` is text and qualifies).
- The tab's text has loaded. Until then nothing is mounted, not even a read-only view.

`ctx.edit` carries:

| Field           | What it is                                                              |
| --------------- | ----------------------------------------------------------------------- |
| `tabId`         | The tab this mount shows. Use it as the key for your screen state       |
| `text`          | The tab's current text, unsaved changes included — not the file on disk |
| `markChanged()` | Call it whenever the document changes. It serializes nothing            |

## Reporting changes and handing the text back

Call `ctx.edit.markChanged()` on every change, as often as you like — on every pointer move while
drawing is fine. The first call marks the tab as unsaved; later calls cost nothing but restart
the auto-save delay, so the save comes after the user pauses.

Baram calls `getText(el)` when it needs the text and you have reported a change it has not taken
yet — for example to save (Save As too), to switch tabs, to show the source view, to rename the
file, to compare with a file that changed on disk, on a zoom step, when your plugin is turned
off, and right before your viewer is unmounted. After it has taken the text it does not call
again until your next `markChanged()`. Keep `getText`:

- **synchronous and fast** — it runs inside save and tab-switch handling;
- **free of side effects**;
- **free of layout reads** — it can run after `el` has left the document.

If `getText` throws or returns something that is not a string, Baram keeps the last text it took,
switches the tab to the source view and shows a message saying the viewer's latest changes were
not included. Switching back to the preview mounts your viewer again from that text.

## Updates from outside the viewer

`onUpdate` reaches an editing mount in two cases: something other than your viewer changed the
text (the file changed outside Baram while the tab had no unsaved changes, or the user resolved a
conflict), and the zoom level changed. Both carry the current text in `ctx.edit.text` — on a zoom
step it is your own text, taken just before. Compare it with your own serialization and skip the
redraw when they are equal.

Your own saves do **not** send `onUpdate`: unlike a read-only viewer, an editing mount never
reloads its own change from disk.

## Remounting and screen state

Leaving the tab unmounts your viewer, and coming back mounts it again from the tab's text, so
unsaved work comes back. Anything that is not in the text — scroll position, the selected tool,
your undo history — is gone unless you keep it yourself, keyed by `ctx.edit.tabId`. Turning the
source view on and off remounts the same way. In a development build React's Strict Mode mounts a
viewer twice when it first appears; that is expected.

## What Baram does not do for you

- **Undo** inside the viewer is yours. Baram has no undo for a viewer's document.
- **Version history** keeps markdown files only, so there is none for your file type.
- **Do not write the open file with `ctx.files.writeFile`.** That goes around the tab: the unsaved
  dot and auto-save do not see it, and Baram treats it as an outside change — it reloads the tab
  or asks about a conflict. Change an open file through `ctx.edit`.

## Example

`examples/plugins/sketch-pad` in the Baram repository draws lines on a `.strokes` file. It is one
file with no build step and shows each point above: `markChanged()` on every pointer move,
`getText` without layout reads, a redraw only for a different text, and a pen width kept per tab.
