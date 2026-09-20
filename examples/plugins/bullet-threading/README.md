# Bullet Threading

Draws the outline path from the outermost ancestor down to the list item holding the
caret — the way [Logseq's bullet threading][logseq] does.

[logseq]: https://github.com/pengx17/logseq-plugin-bullet-threading


## What it demonstrates

This is the reference for **contributing a ProseMirror plugin to the live editor**. If
you are writing a plugin that draws inside the document, copy this one.

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

## Settings

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `color` | string | `var(--color-accent-default)` | Any CSS colour, including one of the app's own tokens |
| `lineWidth` | number | `1.5` | Pixels, clamped to 0.5–8 |
| `showElbow` | boolean | `true` | Curve into each item instead of a straight drop |

`color` is pasted into a stylesheet, so it is checked against a character allowlist
before use — see `src/css.ts` for what that does and does not guarantee. The host
guarantees a setting's declared *type*, not that its value is usable.

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
