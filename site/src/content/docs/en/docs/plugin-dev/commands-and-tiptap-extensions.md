---
title: "Command palette and Tiptap extensions"
---

## Command Palette integration

Passing `opts.title` or `opts.paletteVisible: true` to
`context.commands.register(id, handler, opts)` surfaces the command in the
app's Command Palette, namespaced as `${pluginId}.${id}` (so two plugins can
both register a command literally called `id` without colliding). The
palette entry shows `opts.title` if given, otherwise the raw `id`. Disposing
the returned `Disposable` (or unloading the plugin) removes the palette
entry along with the command registration.

```typescript
context.commands.register("summarize", () => summarize(), {
  title: "AI Summary: Summarize current document",
  paletteVisible: true,
});
```

## Tiptap Extension plugins

Plugins can contribute a ProseMirror plugin to the live editor. Declare it in
the manifest, and require the `extensions` capability:

```json
{
  "capabilities": ["extensions"],
  "tiptapExtensions": [
    {
      "type": "plugin",
      "name": "highlighter",
      "exportName": "Highlighter"
    }
  ]
}
```

`type` must be `"plugin"` — `"node"` and `"mark"` are **rejected** by
`validateManifest`. A node or a mark changes the ProseMirror *schema*, and
the schema is built once, when the editor is created, before any plugin
loads. There is no supported way for a plugin to add to it yet. Decorations,
keyboard handlers, input rules and paste rules — most of what an editor
plugin wants — all fit inside a ProseMirror `Plugin`, so this is rarely a
real limitation.

Then export a **factory** from your entry point. The factory receives a
context object and must return exactly one ProseMirror `Plugin`:

```javascript
import { Plugin } from "@tiptap/pm/state";

// `ctx.key` is minted by the app. Use it — a plugin built with any other key is
// refused, because the app removes exactly this key when your plugin unloads.
export const Highlighter = (ctx) =>
  new Plugin({
    key: ctx.key,
    props: { decorations: (state) => buildDecorations(state, ctx.settings) },
  });

export function activate(context) {
  // Additional plugin logic
}
```

**The app mints the key — you don't choose one.** Build your plugin with
anything other than `ctx.key` and registration is refused: unloading has to
remove exactly this plugin's key and nothing else, and letting authors pick
their own key would let two plugins collide (with each other, or with the
app's own plugins). The context also carries `ctx.editor` (see below),
`ctx.pluginId`, and `ctx.settings` (the plugin's resolved settings).

A contribution may not set `props.editable`, either — that call is refused
too. Editability belongs to the editor's own Editable extension and to vim
(§298 §12-⑪); a third owner that could veto it would defeat that contract.

**No restart.** Tiptap plugins install (or uninstall) on the editor the
moment your plugin activates or unloads — through the ordinary
`editor.registerPlugin` / `editor.unregisterPlugin` API, not a schema
rebuild. Reloading the plugin from the Developer section (see below) picks
up a changed contribution immediately.

### Two traps

**Don't touch the editor's DOM directly.** ProseMirror's `DOMObserver`
watches `view.dom`'s whole subtree, including attribute changes, and for a
node with a `contentDOM` it does **not** ignore them — it re-reads that
range as if it were a document change and redraws it. An attribute a plugin
writes from outside the editor gets wiped out immediately, any widget
decoration sitting in that range gets recreated (visible flicker), and
`readDOMChange` can turn the "change" into a real document transaction. If
you need to draw something in the editor, contribute a `"plugin"` and use
decorations — that's what this API is for.

**There is more than one editor.** An inactive tab's `MarkdownSurface` stays
mounted under `display: none` rather than unmounting, and a keep-alive
editor is mounted alongside the visible one — so
`document.querySelector(".tiptap")` will usually find a hidden editor, not
the one the user is looking at. A contributed plugin's factory is handed its
own `ctx.editor` for the surface it was installed on, so it never has to
guess.
