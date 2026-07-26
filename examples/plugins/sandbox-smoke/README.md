# Sandbox Smoke (§260 Phase 3c-3)

An internal fixture, not a real plugin: it exercises everything a **sandboxed** plugin
can reach and reports the outcome in one toast. Headless CI cannot create a real
`WebviewWindow`, so this is the only way to verify that the sandboxed runtime works
outside unit tests.

## Run it

1. `git checkout` a build that has §260 3c-2c (PR #302) merged.
2. Open `index.mjs` and set `VAULT_DIR` to the absolute path of the vault folder you
   will open in the app. Leaving it empty still runs the rest (the report says
   `files~(set VAULT_DIR)`), but skips the only *allowed* file read.
3. Start the app with plugins enabled:
   ```sh
   VITE_ENABLE_PLUGINS=1 npm run tauri dev
   ```
4. Open that vault folder (the brokered file ops are deny-by-default until a folder or
   file context is open — that is the §88 rule, not a plugin rule).
5. Settings → Plugins → **Add dev folder** → pick `examples/plugins/sandbox-smoke`.
   It should install and show the **sandboxed** trust badge.
6. Enable it. A hidden `plugin-baram-sandbox-smoke` webview is created and the plugin's
   bundle is imported from a `blob:` URL.
7. Command palette (`Cmd+K`) → **Sandbox Smoke: run all checks**.

## Reading the result

One error toast beginning `SMOKE`. **The rejection is the report** — a sandboxed plugin
has no `ui` API, nothing consumes its `events.emit` yet, and the palette shows only
rejections, so throwing is the only channel that reaches the screen today.

| Field | Means |
| --- | --- |
| `cmd✓` | palette → host → sandbox → handler round-trip works |
| `storage✓(n)` | `storage` read/write/list/remove through `plugin_call`, `n` keys seen |
| `out✓` | reading `/etc/hosts` was refused by the vault rule |
| `list✓(n)` | `files:readonly` read of `VAULT_DIR` returned `n` entries |
| `ro✓` | a write was refused — the readonly grant does not admit it (any-of authz) |
| `state✓` | `<vault>/.baram/config.json` was refused as app state |
| `models✓(n)` | `ai.listModels()` through the host bridge |
| `ai✓(len=n:…)` | `ai.complete()` — **the path 3c-2c's review found was dead** |
| `stream✓(n tok/m ch)` | `ai.stream()` under the SAME options as `complete` |

`ai` and `stream` are deliberately reported by size and run with identical options,
because the first live run (2026-07-26) returned `ai✓()` — resolved, but empty. The
pair localizes that without guessing: both empty ⇒ no token reached the host; stream
non-empty while complete is empty ⇒ the host's buffering; both non-empty ⇒ the first
run's `maxTokens: 8` was simply too tight for the configured model (a reasoning model
can spend that budget before emitting any content), i.e. a fixture artifact.

`✗` = that check failed. `~` = it was refused, but with an unexpected message (still
worth reporting verbatim). Anything other than all-`✓` means stop and fix before
Phase 5.

## Expected noise, not failures

- A CSP refusal for `ws://localhost:1420/` in the sandbox realm. Vite's HMR socket is
  blocked there on purpose (`connect-src ipc: http://ipc.localhost`).
- `ai✗` with a provider/key/privacy-mode message if no model is configured — that is
  the host's shared AI policy refusing, which still proves the bridge works. Configure
  a provider and re-run to see `ai✓`.

## Known gap this fixture exposes

A sandboxed plugin has **no way to learn a path**: the activate frame carries only
`pluginId`, `SandboxContext` exposes no vault or plugin path, and no app event is
forwarded to a sandbox yet (`SandboxSession.deliverEvent` exists but nothing calls it).
That is why `VAULT_DIR` is a hand-edited constant here. `files` is therefore enforced
but not yet *usable* by a real sandboxed plugin — Phase 4 has to supply paths, whether
through the activate frame, a brokered "which contexts are open" op, or command
arguments from contributions.
