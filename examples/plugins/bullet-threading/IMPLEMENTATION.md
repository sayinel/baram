# Bullet Threading — implementation notes

For plugin authors. **`README.md` is the file that ships inside the archive**, so it is
written for the person installing the plugin; this one is not packaged and is written for
the person copying it.

This is the reference for **contributing a ProseMirror plugin to the live editor**. If you
are writing a plugin that draws inside the document, copy this one.

```jsonc
{
  "capabilities": ["extensions", "settings"],
  "tiptapExtensions": [
    { "type": "plugin", "name": "threading", "exportName": "Threading" }
  ]
}
```

The factory is handed a context and returns exactly one ProseMirror `Plugin`:

```ts
export const Threading = (ctx) =>
  new ctx.pm.Plugin({
    key: ctx.key,
    props: { decorations: (state) => threadDecorations(state, ctx.pm) },
  });
```

## The two rules that are easy to get wrong

**Take ProseMirror off `ctx.pm`. Never import it.**

A plugin ships its own bundle, so `import { DecorationSet } from "@tiptap/pm/view"`
inside it resolves to a *second copy* of prosemirror-view. That copy is not a heavier
build — it is a crash. One decoration source alone happens to work, which is what makes
the trap quiet in a small test; as soon as anything else is also decorating (the app's
own extensions always are) the view builds a `DecorationGroup` over both and dies walking
it: `Cannot read properties of undefined (reading 'localsInner')`.

`ctx.pm` carries the host's `Decoration`, `DecorationSet`, `Plugin` and `PluginKey`. It
is frozen. Build everything from it, for the same reason you build your plugin with
`ctx.key` rather than a key of your own: there has to be one identity, and the host is
the one that can guarantee it.

`npm run build` on this plugin produces a bundle with no ProseMirror in it at all, and
`src/plugins/__tests__/bullet-threading-example.test.ts` asserts that.

**Ask the document, not the DOM.**

The first version of this plugin listened for `selectionchange` and wrote `data-*`
attributes onto the `<li>` elements it found by walking `view.dom`. It never worked.
ProseMirror's `DOMObserver` watches the whole subtree including attributes, does not
ignore them for a node with a `contentDOM`, and re-reads the range as a document change —
so the attributes were wiped as fast as they were written, and the fold triangles in that
range flickered as their widget decorations were recreated.

`ancestorRungs($pos)` asks the model the same question by walking resolved-position
depths, and decorations let the view do the writing. The result has no event listener,
nothing to unsubscribe, and no cached previous state that can drift out of step with the
document.

## Settings, and the limit they expose

The declared fields live under `contributions.settings` in the manifest — **not** at the
top level, which is a mistake this plugin actually shipped: `PluginManifest` has no
top-level `settings` field, the host reads `contributions.settings`, and
`validateManifest` ignores unknown keys by design, so the three controls it advertised
rendered nowhere and nothing failed.

`color` is pasted into a stylesheet, so it is checked against a character allowlist
before use — see `src/css.ts` for what that does and does not guarantee. The host
guarantees a setting's declared *type*, not that its value is usable.

**Changing a setting takes effect on the next plugin load, not immediately.** The plugin
API has no settings-change event — `PluginEventName` is `editor:ready`, `file:open`,
`file:save` — and `SettingsAPI` offers only `getAll()`, so nothing calls back into a
plugin when a value changes. This plugin builds its stylesheet once, in `activate`, which
is where that limit becomes visible.

A prop that runs per state change *is* live, because it can call
`context.settings.getAll()` each time it runs; a stylesheet injected once cannot. If you
are writing a plugin whose settings must apply immediately, put what they control on the
decoration rather than in the stylesheet.

The manifest's declared defaults are asserted against this plugin's own
`DEFAULT_SETTINGS` by `bullet-threading-example.test.ts`, because the two drifting apart
is silent: the manifest said `1.5` while the code said `2`, and wiring the dead field up
would have changed the rendering with nothing reporting it.

## Layout

| | |
| --- | --- |
| `src/thread.ts` | `ancestorRungs($pos)` — the list-item chain, outermost first |
| `src/threading.ts` | the ProseMirror plugin: rungs in, decorations out |
| `src/css.ts` | the stylesheet, derived from the editor's own custom properties |
| `src/index.ts` | `activate` (injects the style) and the exported factory |
| `src/types.ts` | the host shapes, written out rather than imported |

`src/types.ts` spells the context out structurally instead of importing Baram's types,
because a third-party plugin has no access to them — and writing them down is also how
this example shows what the contract actually is.

## Tests

```sh
npm test        # this plugin's own: position arithmetic, real prosemirror-model
```

These use a minimal list schema and never import Baram, the same way a third-party
plugin could not. The layer that matters most lives in the app instead —
`src/plugins/__tests__/bullet-threading-example.test.ts` runs this plugin's built
`dist/index.mjs` through the real manifest validator and the real editor-surface
registry, on an editor built from `createBaramExtensions()`. Four defects in this
feature reached a running app before that layer existed; a plugin's own tests cannot
see any of them.

‼️ A fifth reached a running app *after* it existed, and neither layer could see it: the
install path skipped `loadPlugin` for any manifest declaring `tiptapExtensions`, so the
plugin installed and did nothing until it was toggled off and on. The gap was that no
test exercised INSTALL for a contributing plugin — only load. See
`plugin-install-consent.test.tsx`.
