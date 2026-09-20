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
`validateManifest`. A node or a mark changes the ProseMirror *schema*, and a
schema is fixed when its editor is created. There is also more than one
editor to reach: besides the shared one, the app builds a keep-alive editor —
a separate editor with its own schema — each time a large document is loaded,
which can happen long after plugins have loaded. There is no supported way for
a plugin to add to a schema yet. Decorations, keyboard handlers, input rules and paste rules —
most of what an editor plugin wants — all fit inside a ProseMirror `Plugin`,
so this is rarely a real limitation.

Then export a **factory** from your entry point. The factory receives a
context object and must return exactly one ProseMirror `Plugin`:

```javascript
// Nothing is imported from ProseMirror. See "Build with ctx.pm" below — a copy of
// your own is not a heavier bundle, it is a crash.

let host; // the context `activate` is handed, kept for live settings reads

// `ctx.key` is minted by the app. Use it — a plugin built with any other key is
// refused, because the app removes exactly this key when your plugin unloads.
export const Highlighter = (ctx) =>
  new ctx.pm.Plugin({
    key: ctx.key,
    // Not `ctx.settings`: that is the snapshot this factory was built with.
    props: {
      decorations: (state) =>
        buildDecorations(state, ctx.pm, host.settings.getAll()),
    },
  });

export function activate(context) {
  host = context;
}
```

**The app mints the key — you don't choose one.** Build your plugin with
anything other than `ctx.key` and registration is refused: unloading has to
remove exactly this plugin's key and nothing else, and letting authors pick
their own key would let two plugins collide (with each other, or with the
app's own plugins). The context also carries `ctx.pm` (see below),
`ctx.editor` (see further below), `ctx.pluginId`, and `ctx.settings`.

### Build with `ctx.pm`, never with your own import

`ctx.pm` holds the app's own `Decoration`, `DecorationSet`, `Plugin` and
`PluginKey`. It is frozen. Use it for everything ProseMirror, and import
nothing from `@tiptap/pm/*` in a plugin that contributes to the editor.

Your plugin ships as its own bundle, so an `import` of `@tiptap/pm/view`
inside it resolves to a **second copy** of prosemirror-view. That copy does
not interoperate with the app's, and the failure is worth stating precisely,
because it is quiet in the place you are most likely to test:

| Decoration sources | A `DecorationSet` from your own copy |
| --- | --- |
| Yours alone | Registers, renders, survives a transaction — looks fine |
| Yours plus any other | `Cannot read properties of undefined (reading 'localsInner')` |

The editor's own extensions are always decorating something, so the second
row is what a user gets. A small reproduction can easily hit the first and
convince you the import is harmless.

The argument is the same one behind `ctx.key`: there has to be a single
identity, and the app is the only party that can guarantee it.

If you use a bundler, this also means you do not need `@tiptap/pm` as a
dependency at all — `examples/plugins/bullet-threading` builds to a bundle
with no ProseMirror in it, and a test asserts that.

**`ctx.settings` is a load-time snapshot, not a live view.** It holds your
plugin's resolved settings as they were when the plugin loaded. Changing a
value in the plugin's settings form does not reload the plugin, so nothing
re-runs your factory — a prop that reads `ctx.settings` keeps handing out the
values the plugin started with. When you need the current answer, call
`context.settings.getAll()` (the `context` your `activate` was given; it needs
the `settings` capability) at the moment you need it. Reloading the plugin is
what refreshes the snapshot.

**Nothing calls back when a setting changes.** There is no settings event —
`PluginEventName` is `editor:ready`, `file:open` and `file:save` — and
`SettingsAPI` offers only `getAll()`. A prop that runs per state change is
therefore live, because it can read the current value each time it runs; work
done once in `activate`, such as injecting a stylesheet, is not, and stays at
the value the plugin started with until it is reloaded. If a setting must apply
immediately, put what it controls on the decoration rather than in a stylesheet.

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

**There is more than one editor.** The markdown surface mounts the shared
editor and — for a large document — a keep-alive editor as siblings, with
`display: none` on whichever is inactive, so
`document.querySelector(".tiptap")` can return the hidden one rather than
the editor the user is looking at. A contributed plugin's factory is handed
its own `ctx.editor` for the surface it was installed on, so it never has to
guess.
