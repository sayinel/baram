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

| Capability        | Why it's needed                                           |
| ----------------- | --------------------------------------------------------- |
| `editor:readonly` | `ctx.editor.getMarkdown()` to read the document           |
| `events`          | `ctx.events.on(...)` to recompute on ready / open / save  |
| `statusbar`       | `ctx.ui.setStatusBarText(...)` to write the declared item |

The status-bar item itself is **declared** in `baram-plugin.json` under
`contributions.statusBar`; code addresses it by id. The host refuses an id that was not
declared, so the manifest and the code have to agree.

## Ported from the trusted tier — what changed (v1.0.1 → v2.0.0)

| trusted (v1)                                                 | sandboxed (v2)                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ctx.ui.showStatusBarItem("0 words", "right")` → item handle | `contributions.statusBar` + `ctx.ui.setStatusBarText("count", …)` |
| `ctx.editor.getContent()` (sync, flat text)                  | `await ctx.editor.getText()` (async, prose)                       |
| `ctx.ui.addStyle(STYLE)`                                     | **gone** — no DOM and no CSS in this tier                         |
| `export function deactivate()`                               | **gone** — never called; teardown destroys the realm              |

A major version because the tier changed: an existing v1 install is a pre-`trust` record the
app will not auto-run, so updating is a re-consent rather than a patch. The sandboxed runtime
has never shipped in a release before 0.5.0, so no earlier build can run this plugin at all;
the floor now sits higher than that for the reason in the next section.

### 2.0.0 → 2.1.0 — the count was of the markdown source

2.1.0 counts prose; 2.0.0 counted the markdown SOURCE. `engines.baram` moves to `>=0.6.1`
with it, because that is the release adding the API this version calls: on any earlier build
`ctx.editor.getText` is undefined, `update()` throws, and the item never leaves the text the
manifest declares. Baram evaluates that floor before installing or updating (`>=X.Y.Z` is the
only grammar it reads) and names the version needed — but that evaluation itself only shipped
in 0.6.0, so a 0.5.x build offers the install anyway. That is why the app release goes out
before this plugin's tag is pushed, rather than the floor being the whole protection.

The history is the lesson worth copying.

The trusted tier's `editor.getContent()` returned flat text; the sandboxed tier had only
`getMarkdown()`. So 2.0.0 counted the markdown SOURCE — heading marks, list bullets, table
pipes and emphasis marks all became words, and the character count read well above v1's for
the same document. On `docs/keyboard-shortcuts.md` that is 1,611 "words" against 973 of actual
prose, and the app's own status bar sat right next to it showing a third number.

That was left VISIBLE rather than papered over with a regex markdown-stripper, because the
real gap was a missing protocol member, and an approximate stripper inside a reference plugin
would teach the wrong lesson. The fix was to add the member: `SandboxEditorAPI.getText()`
returns the document's prose — block text with real separators, code blocks and frontmatter
excluded, a wikilink's label included — computed by the very function the status bar counts.
So this plugin now AGREES with the number beside it instead of contradicting it.

**Rule of thumb for your own plugin:** `getText()` to read or measure the text, `getMarkdown()`
only to round-trip it. A word count over `getMarkdown()` counts syntax as words.

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
