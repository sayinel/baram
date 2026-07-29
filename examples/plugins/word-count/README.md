# Word Count

The canonical **sandboxed** Baram plugin (§260). Shows the current document's word and
character count in a status-bar item, recomputed when the editor becomes ready, a file is
opened, or a file is saved.

Two things it exists to prove:

1. `examples/plugins/plugin-api.d.ts` (the published plugin API surface) is genuinely usable
   by a standalone author — `src/index.ts` typechecks against the committed `.d.ts` with no
   access to Baram's internal source.
2. A real, useful plugin needs **nothing** from the main realm. It runs in its own webview,
   holds three capabilities, and every call it makes is authorized per-call in Rust.

## Capabilities

| Capability        | Why it's needed                                            |
| ----------------- | ---------------------------------------------------------- |
| `editor:readonly` | `ctx.editor.getMarkdown()` to read the document            |
| `events`          | `ctx.events.on(...)` to recompute on ready / open / save   |
| `statusbar`       | `ctx.ui.setStatusBarText(...)` to write the declared item   |

The status-bar item itself is **declared** in `baram-plugin.json` under
`contributions.statusBar`; code addresses it by id. The host refuses an id that was not
declared, so the manifest and the code have to agree.

## Ported from the trusted tier — what changed (v1.0.1 → v2.0.0)

| trusted (v1) | sandboxed (v2) |
| --- | --- |
| `ctx.ui.showStatusBarItem("0 words", "right")` → item handle | `contributions.statusBar` + `ctx.ui.setStatusBarText("count", …)` |
| `ctx.editor.getContent()` (sync, flat text) | `await ctx.editor.getMarkdown()` (async, markdown source) |
| `ctx.ui.addStyle(STYLE)` | **gone** — no DOM and no CSS in this tier |
| `export function deactivate()` | **gone** — never called; teardown destroys the realm |

A major version because the tier changed: an existing v1 install is a pre-`trust` record the
app will not auto-run, so updating is a re-consent rather than a patch. `engines.baram` is
`>=0.5.0` — the sandboxed runtime has never shipped in a release before that, so no earlier
build can run this plugin. Note that Baram does not currently *enforce* `engines`: it validates
the field's presence and never compares versions, so the floor is a statement to a human
reading the manifest, not a gate.

### Known difference: the count is of the markdown source

The trusted tier's `editor.getContent()` returned flat text. This tier has only
`getMarkdown()`, so heading marks, list bullets, table pipes and emphasis marks are counted
too — the character count in particular reads higher than v1 for the same document.

This is left visible rather than papered over with a regex markdown-stripper: the real gap is
that the sandboxed editor surface has no flat-text read, and an approximate stripper inside
the reference plugin would teach the wrong lesson. Adding `getText()` to `SandboxEditorAPI`
is a contribution-surface change, tracked with the rest of Phase 4's remainder.

## Build

```bash
npm i && npm run build
```

`esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs` — note there are **no
`--external` flags**. A sandboxed plugin is imported from a `blob:` URL, which has no base
URL, so a bare `import` left in the output cannot resolve and the plugin fails at activate.
Everything must be bundled in. The committed `dist/index.mjs` is already built.

## Dev-load in Baram

1. Settings → Plugins → Developer.
2. "Load dev plugin folder" → this directory (`examples/plugins/word-count`).
3. The count appears in the status bar. It shows the manifest's declared text until the first
   `file:open` arrives — the host subscribes the sandbox to events only after `activate`
   resolves and then replays the open file, which is what produces the first count.

There is no live per-keystroke event, by design.

## Notes

- `tsconfig.json` includes the committed `../plugin-api.d.ts` (and its `../types.d.ts`
  sibling) directly — no package install is needed to typecheck this example from the repo
  root.
- `styles.css` is gone with `addStyle`. Styling host-rendered status-bar items is not
  something this tier can do yet.
