# AI Summary

Advanced Baram plugin example. Adds a Shadow-DOM sidebar panel with a
"Summarize" button that sends the current document to the app's configured
AI provider and shows the result, plus a Shadow-DOM settings tab for
customizing the summarization prompt prefix. The last summary and the
prompt prefix are both cached via `ctx.storage` so they survive an
app/editor restart.

This example exists to prove that `examples/plugins/plugin-api.d.ts` (the
public plugin API surface) genuinely supports the Phase C/D advanced
surfaces — `ai`, `storage`, Shadow-DOM `sidebar`/`settings` panels — from a
real, standalone plugin author's perspective: `src/index.ts` typechecks
against the committed `.d.ts` with no access to Baram's internal source.

**Requires an AI provider configured in Settings → AI** (any provider Baram
supports — Claude, OpenAI, Ollama, etc.). If none is configured, or privacy
mode blocks the configured provider, `ctx.ai.complete()` rejects and the
panel shows the error via `ctx.ui.showNotification(..., "error")` instead of
a summary.

## Shadow-DOM styling

Both `onMount(el)` callbacks (sidebar panel and settings tab) append their
own `<style>` element directly to `el` — **not** `ctx.ui.addStyle()`.
`addStyle()` injects into `document.head` (light DOM) and cannot reach
Shadow-DOM content (see `src/components/plugins/PluginShadowMount.tsx` in
the host: `onMount` receives the Shadow-root's inner content `<div>`, not
`document`). CSS custom properties (`var(--color-text-default)`,
`var(--color-border-default)`, etc.) still inherit across the shadow
boundary, so both panels theme themselves against the app's real design
tokens without needing to duplicate their values.

## Capabilities

| Capability        | Why it's needed                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| `ai`               | `ctx.ai.complete(...)` to summarize the document                                 |
| `editor:readonly`  | `ctx.editor.getContent()` to read the document text to summarize                 |
| `settings`         | `ctx.ui.addSettingsTab(...)` for the prompt-prefix configuration surface          |
| `sidebar`          | `ctx.ui.addSidebarPanel(...)` for the "Summarize" panel                          |
| `storage`          | `ctx.storage.read/write(...)` to cache the last summary and the saved prefix      |

`network` is deliberately **not** declared: `ctx.ai.complete()` routes
through the app's own LLM proxy/plumbing (Rust-side `llmComplete`), not
`ctx.network.fetch()` — the plugin never makes its own HTTP requests.

`editor` (read/write) is **not** declared either — the plugin only reads
the document (`editor:readonly`) to build the summarization prompt; it
never modifies the document.

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
   (`examples/plugins/ai-summary`).
3. Open a document, then open the "AI Summary" sidebar panel and click
   "Summarize" — the summary appears in the panel and is cached.
4. Open Settings → Plugins → AI Summary to customize the prompt prefix used
   for future summaries.

## Notes

- `styles.css` in this directory is **not** auto-loaded by the host; it
  mirrors the CSS both panels inject at runtime via a `<style>` element
  appended inside `onMount(el)`, for reference and standalone authoring
  convenience only.
- `tsconfig.json` includes the committed `../plugin-api.d.ts` (and its
  `../types.d.ts` sibling) directly — no package install is required to
  typecheck this example from the repo root.
- Storage keys used: `last-summary.txt` (cached summary text) and
  `config.json` (`{ "prefix": string }`, the saved prompt prefix).
