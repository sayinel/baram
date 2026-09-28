# Baram Plugin Examples

This directory holds the canonical, buildable example plugins for Baram's
§69 plugin system, plus the generated public type declarations that every
plugin author's `tsconfig` compiles against.

> The other files in `examples/` one level up (`Dijkstra's Algorithm.md`,
> `Graph Theory.md`, `Bellman-Ford.md`, `Priority Queue.md`, and that
> directory's own `README.md`) are an unrelated demo **vault** used to show
> off Baram's editor features (math, Mermaid, wikilinks, backlinks). They
> have nothing to do with the plugin system and are not touched by anything
> in this directory. `examples/themes/`, also one level up, is not part of
> that vault either: it is the publish source of Baram's reference theme,
> Baram Hangul (`examples/themes/hangul/` — its README is the maintainer
> note).

For the full narrative guide (trust model, capability list, event system,
Shadow-DOM panels, etc.), see the **[plugin developer docs](https://baram.ing/en/docs/plugin-dev/overview-and-capabilities/)**.
This README is just the index + regen note for what lives in this folder.

## Contents

```
examples/plugins/
  plugin-api.d.ts       # generated public type barrel (commit this)
  types.d.ts            # generated sibling the barrel re-exports from (commit this)
  word-count/           # the canonical sandboxed plugin, published by Baram
  community-template/   # ← START HERE to publish your own plugin (see below)
  bullet-threading/     # full-trust editor-contribution example, published by Baram
  ai-summary/           # full-trust example — NOT published (see below)
  sandbox-smoke/        # internal test fixture — NOT a template (see below)
  malicious-fixture/    # internal test fixture — NOT a template (see below)
```

**Looking for an editor-contribution example?** `bullet-threading/` is the
one that contributes a Tiptap/ProseMirror extension — `word-count/`,
`community-template/` and `ai-summary/` stick to UI and events, not editor
behavior. A plugin can contribute ProseMirror
`Plugin`s (decorations, keyboard handlers, input rules — not a new node or
mark; see below) to the live editor via `tiptapExtensions` + the
`extensions` capability: one per `tiptapExtensions` entry, and the
manifest validator sets no limit on how many entries one plugin
declares. For the factory shape, the two traps that catch
editor-touching plugins, and why `type: "node"`/`"mark"` are rejected, see
[Tiptap Extension plugins](https://baram.ing/en/docs/plugin-dev/commands-and-tiptap-extensions/#tiptap-extension-plugins)
in the docs. `bullet-threading/` asks for full trust, so it shows the API
rather than a shape a community plugin can take — the community registry
accepts sandboxed plugins only.

**Publishing your own plugin? Copy `community-template/`.** It is a sandboxed plugin with an id
outside the `baram-` prefix that Baram reserves, plus a release workflow that builds the ZIP and
prints its `sha256`. Its README lists what to change, and
[Publishing to the community registry](https://baram.ing/en/docs/plugin-dev/community-registry/)
covers the submission.

`word-count/` is Baram's own reference sandboxed plugin: `trust: "sandboxed"`, published to the
registry as v2.1.0. Read it for a complete plugin; its `baram-` id is reserved, so a copy of it
cannot be submitted as is.

`ai-summary/` is kept as the example of what the **full-trust** tier can do (a Shadow-DOM sidebar
panel, which the sandboxed tier has no surface for yet). It is deliberately **not published** —
a published full-trust plugin would train users to click through the full-trust warning for
ordinary functionality. Read it for the API; do not use it as the template for something you
intend to publish.

`sandbox-smoke/` and `malicious-fixture/` are **not examples to copy**. Both are internal §260
fixtures written to be diagnostic rather than idiomatic: `sandbox-smoke/` reports by THROWING
and is a hand-written single file with no build step, and `malicious-fixture/` exists to probe
deny paths in CI — it asks for capabilities it must not receive, on purpose.

## The examples

Every example is a real, standalone TypeScript project with no access to Baram's internal
source tree. `word-count/`, `ai-summary/` and `community-template/` `import type` from the
committed `../plugin-api.d.ts` (and its `types.d.ts` sibling); `bullet-threading/` writes the
shapes it uses out in its own `src/types.ts`. `word-count/`, `ai-summary/` and
`bullet-threading/` ship a prebuilt, committed `dist/index.mjs` so you can dev-load them
immediately without running `npm i && npm run build` first. `community-template/` does not —
build it once before dev-loading it.

Dev-loading a folder happens in Baram → Settings → Plugins → Developer → "Load dev plugin
folder". A release build keeps that off until you turn on **Developer mode** in the same
section, and even then refuses a `baram-` id and a full-trust (`trusted`) folder — so of the
folders here only `community-template/` passes a release build's id and trust rules unchanged
(once built). The others load unchanged in a development build (`npm run tauri dev`); see
[Local development](https://baram.ing/en/docs/plugin-dev/local-development-and-bundling/).

### `word-count/` — the sandboxed reference

Shows the current document's word and character count in a right-aligned
status-bar item, recomputed on `editor:ready`, `file:open`, and `file:save`.

- **Capabilities:** `editor:readonly`, `events`, `statusbar`
- **Build:** `cd examples/plugins/word-count && npm i && npm run build`
  (runs `esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs`)
- **Dev-load:** Baram → Settings → Plugins → Developer → "Load dev plugin
  folder" → pick `examples/plugins/word-count`.

See [`word-count/README.md`](word-count/README.md) for details.

### `community-template/` — the starting point for a community plugin

Shows the current document's character count in the status bar. It is the template the
community registry docs point to: copy it into your own repository, rename it, and publish a
GitHub Release with the workflow it carries.

- **Capabilities:** `editor:readonly`, `events`, `statusbar`
- **Build:** `cd examples/plugins/community-template && npm i && npm run build`
- **Dev-load:** after the build, pick `examples/plugins/community-template`.

See [`community-template/README.md`](community-template/README.md) for the steps.

### `bullet-threading/` — full trust, editor contribution, published

Draws a line from the outermost list ancestor down to the list item the caret is in, through a
ProseMirror `Plugin` it contributes with `tiptapExtensions`.

- **Capabilities:** `extensions`, `settings`
- **Build:** `cd examples/plugins/bullet-threading && npm i && npm run build`
- **Dev-load:** in a development build, pick `examples/plugins/bullet-threading`. A release
  build refuses a full-trust folder.

See [`bullet-threading/README.md`](bullet-threading/README.md) for details.

### `ai-summary/` — full trust, not published

A Shadow-DOM sidebar panel with a "Summarize" button that sends the current
document to the app's configured AI provider and displays the result, plus a
Shadow-DOM settings tab for customizing the summarization prompt prefix. The
last summary and the prompt prefix are cached via `ctx.storage` so they
survive an app/editor restart.

- **Capabilities:** `ai`, `editor:readonly`, `settings`, `sidebar`, `storage`
- **Build:** `cd examples/plugins/ai-summary && npm i && npm run build`
  (runs `esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs`)
- **Dev-load:** Baram → Settings → Plugins → Developer → "Load dev plugin
  folder" → pick `examples/plugins/ai-summary`. Requires an AI provider
  configured in Settings → AI.

See [`ai-summary/README.md`](ai-summary/README.md) for details.

## The public types (`plugin-api.d.ts` + `types.d.ts`)

`plugin-api.d.ts` and `types.d.ts` are **generated, committed artifacts** —
they are not hand-written and not gitignored (the repo's global `dist/`
ignore is deliberately negated for `examples/plugins/**/dist/index.mjs`, and
these two `.d.ts` files live outside any `dist/` directory in the first
place).

- **Source of truth:** `src/plugins/public-api.ts` (a curated re-export
  barrel over `src/plugins/types.ts`, the app's internal plugin-API surface).
- **Generator:** `npm run types:plugin`, which runs
  `tsc -p tsconfig.plugin-api.json` (declaration-only emit) and moves the
  result into place as `plugin-api.d.ts`, alongside the `types.d.ts` sibling
  TypeScript emits for the barrel's re-exported types.
- **`plugin-api.d.ts`** is what plugin authors should import from — it
  re-exports every public interface (`ExtensionContext`, all `*API`
  interfaces, `PluginManifest`/`PluginCapability`/`PluginEventName`, and the
  option/record types). `types.d.ts` is a required sibling the barrel depends
  on; it is not meant to be imported directly, though nothing prevents it.

### Regen / drift note

**Whenever `src/plugins/types.ts` (the public plugin-API surface) changes,
you MUST re-run `npm run types:plugin` and commit the resulting diff to
`examples/plugins/plugin-api.d.ts` and `examples/plugins/types.d.ts`.**
No build step regenerates them. `npm run types:plugin:check` — part of `npm run lint`, which
the CI lint job runs — regenerates them and fails on any diff, so a stale pair turns the pull
request red rather than reaching plugin authors.

All four example plugins' `tsconfig.json` include the committed `.d.ts` files
directly via a relative path (`../plugin-api.d.ts`, `../types.d.ts`). In
`word-count/`, `ai-summary/` and `community-template/`, which import from them,
re-running `npm run typecheck` after a regen is the quickest way to confirm the
new surface still typechecks against real plugin code. `bullet-threading/` does
not import them, and every example sets `skipLibCheck`, so its typecheck says nothing about
the pair's own types.
