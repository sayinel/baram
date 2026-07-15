# Baram Plugin Examples

This directory holds the canonical, buildable example plugins for Baram's
§69 plugin system, plus the generated public type declarations that every
plugin author's `tsconfig` compiles against.

> The other files in `examples/` one level up (`Dijkstra's Algorithm.md`,
> `Graph Theory.md`, `Bellman-Ford.md`, `Priority Queue.md`, and that
> directory's own `README.md`) are an unrelated demo **vault** used to show
> off Baram's editor features (math, Mermaid, wikilinks, backlinks). They
> have nothing to do with the plugin system and are not touched by anything
> in this directory.

For the full narrative guide (trust model, capability list, event system,
Shadow-DOM panels, etc.), see **[`docs/plugin-development.md`](../../docs/plugin-development.md)**.
This README is just the index + regen note for what lives in this folder.

## Contents

```
examples/plugins/
  plugin-api.d.ts     # generated public type barrel (commit this)
  types.d.ts          # generated sibling the barrel re-exports from (commit this)
  word-count/         # minimal example plugin
  ai-summary/          # advanced example plugin
```

## The examples

Both examples are real, standalone TypeScript projects: they `import type`
exclusively from the committed `../plugin-api.d.ts` (and its `types.d.ts`
sibling), with no access to Baram's internal source tree. Each ships a
prebuilt, committed `dist/index.mjs` so you can dev-load it immediately
without running `npm i && npm run build` first.

### `word-count/` — minimal

Shows the current document's word and character count in a right-aligned
status-bar item, recomputed on `editor:ready`, `file:open`, and `file:save`.

- **Capabilities:** `editor:readonly`, `events`, `statusbar`
- **Build:** `cd examples/plugins/word-count && npm i && npm run build`
  (runs `esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs`)
- **Dev-load:** Baram → Settings → Plugins → Developer → "Load dev plugin
  folder" → pick `examples/plugins/word-count`.

See [`word-count/README.md`](word-count/README.md) for details.

### `ai-summary/` — advanced

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
These files are not regenerated automatically by any build step or CI gate —
if you forget, they silently go stale and plugin authors (and the two
example plugins in this directory) end up typechecking against an outdated
API surface.

Both example plugins' `tsconfig.json` include the committed `.d.ts` files
directly via a relative path (`../plugin-api.d.ts`, `../types.d.ts`), so
re-running their `npm run typecheck` after a regen is the quickest way to
confirm the new surface still typechecks against real plugin code.

There is no automated CI check for this yet (see Open Questions in the
Phase E plan) — treat `npm run types:plugin` as a manual step whenever
`src/plugins/types.ts` changes, the same way `npm run tokens:build` is a
manual step after editing `tokens/*.json`.
