# Sketch Pad (§392)

The example for **editable file viewers**: draw lines with the pointer on a `.strokes` file.
Baram keeps the text — this plugin only reports that the drawing changed
(`ctx.edit.markChanged()`) and hands its drawing back as JSON when Baram asks (`getText`).
Saving, the unsaved dot, auto-save and the conflict prompt are Baram's.

It is a **trusted** plugin (`viewer` + `files`) written as one dependency-free file,
`index.mjs`, with no build step. It is not published to the registry.

## The file

```json
{ "version": 1, "strokes": [[10, 10, 40, 40, 80, 30]] }
```

Each stroke is a flat list of x, y pairs in drawing units on an 800 × 600 sheet, before zoom.
A file that is not this shape opens read-only and is never replaced. An empty file is an empty
drawing.

## Run it

Release builds load only sandboxed plugins from a folder, and refuse the `baram-` id this
example has, so use a development build. (Baram has no way to install a plugin from a local zip
either — plugins install from the registry, which does not list this example.)

1. From the Baram repository root: `npm run tauri dev`.
2. Create a drawing in a vault from a terminal, for example
   `printf '{"version":1,"strokes":[]}' > ~/MyVault/test.strokes`, and open the vault.
3. Settings → Plugins → **Load dev plugin folder** → pick `examples/plugins/sketch-pad`, and
   turn it on.
4. Open `test.strokes` from the file tree.

A development build runs React in Strict Mode, which mounts a viewer twice when it first
appears (mount, unmount, mount). That is expected.

## Manual checks (spec 0071 §10)

Work through these in a development build.

1. **Tab switch.** Draw a few lines, pick 6px, switch to another tab and back. The lines and the
   pen width are still there.
2. **Auto-save.** Draw a line and wait two seconds without drawing. The tab's unsaved dot goes
   away, and `cat ~/MyVault/test.strokes` shows the new stroke.
3. **Outside edit, clean tab.** With no unsaved changes, change the file from a terminal (remove
   a stroke). The canvas shows the change.
4. **Save while drawing.** Turn auto-save off in Settings. Hold the pointer down, press Cmd+S
   (Ctrl+S) while still drawing, and keep drawing. After the save the tab still has its unsaved
   dot; the next Cmd+S writes the rest.
5. **Source view round trip.** Draw, then press Cmd+/ (Ctrl+/): the source shows JSON with the
   new stroke. Change a number, press Cmd+/ again: the canvas shows the change.
6. **Turn the plugin off while unsaved.** With auto-save off, draw, then turn the plugin off in
   Settings → Plugins. The tab shows the JSON in the source view, with your stroke in it and the
   unsaved dot still on.
7. **Undo.** Click the canvas and press Cmd+Z (Ctrl+Z). The last stroke disappears. If the app's
   Edit menu takes the key instead and nothing happens, that is a finding, not a pass.
8. **Outside edit, unsaved tab** — only once the conflict dialog for non-Markdown tabs acts on the
   file it names (a separate fix that has not landed yet). With auto-save off, draw, then change
   the file from a terminal. The conflict dialog opens.
