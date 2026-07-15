# Word Count

Minimal, canonical Baram plugin example. Shows the current document's word
and character count in a right-aligned status-bar item, recomputed whenever
the editor becomes ready, a file is opened, or a file is saved.

This example exists to prove that `examples/plugins/plugin-api.d.ts` (the
public plugin API surface) is genuinely usable by a real, standalone plugin
author: `src/index.ts` typechecks against the committed `.d.ts` with no
access to Baram's internal source.

## Capabilities

| Capability        | Why it's needed                                          |
| ----------------- | -------------------------------------------------------- |
| `editor:readonly` | `ctx.editor.getContent()` to read the document text      |
| `events`          | `ctx.events.on(...)` to recompute on load/open/save      |
| `statusbar`       | `ctx.ui.showStatusBarItem(...)` / `ctx.ui.addStyle(...)` |

## Build

```bash
npm i && npm run build
```

This runs `esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs`,
producing an ES module that exports `activate` (and `deactivate`). The
committed `dist/index.mjs` in this repo is already built, so you do not need
to build it yourself just to try the plugin — only if you change `src/index.ts`.

## Dev-load in Baram

1. Open Baram → Settings → Plugins → Developer.
2. Click "Load dev plugin folder" and point it at this directory
   (`examples/plugins/word-count`).
3. The word/character count appears in the status bar and updates on
   editor-ready, file-open, and file-save (there is no live per-keystroke
   change event in the plugin API, by design).

## Notes

- `styles.css` in this directory is **not** auto-loaded by the host; it
  mirrors the CSS the plugin injects at runtime via `ctx.ui.addStyle()` for
  reference and standalone authoring convenience only.
- `tsconfig.json` includes the committed `../plugin-api.d.ts` (and its
  `../types.d.ts` sibling) directly — no package install is required to
  typecheck this example from the repo root.
