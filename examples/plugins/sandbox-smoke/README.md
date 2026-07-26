# Sandbox Smoke (§260 Phase 3c-3)

An internal fixture, not a real plugin: it exercises everything a **sandboxed** plugin
can reach and reports the outcome in one toast. Headless CI cannot create a real
`WebviewWindow`, so this is the only way to verify that the sandboxed runtime works
outside unit tests.

## What it costs you

Running the command sends **three real LLM requests** (`complete`, `stream`, `complete`)
plus a `listModels` to whichever provider you have configured, using your key. The
prompt is one sentence and `maxTokens` is 64, so the spend is negligible — but it is
not zero, and the prompt does leave your machine. Its only file access is a single
`listDir`; it never reads a file's contents.

## Run it

1. Open `index.mjs` and set `VAULT_DIR` to the absolute path of the vault folder you
   will open in the app. Leaving it empty still runs the rest (the report says
   `files~(set VAULT_DIR)`), but skips the only *allowed* file read.
2. Start the app with plugins enabled:
   ```sh
   VITE_ENABLE_PLUGINS=1 npm run tauri dev
   ```
3. Open that vault folder (the brokered file ops are deny-by-default until a folder or
   file context is open — that is the §88 rule, not a plugin rule).
4. Settings → Plugins → **Add dev folder** → pick `examples/plugins/sandbox-smoke`.
   It should install and show the **sandboxed** trust badge.
5. Enable it. A hidden `plugin-baram-sandbox-smoke` webview is created and the plugin's
   bundle is imported from a `blob:` URL.
6. Command palette — **`Cmd+P`** (`Cmd+K` is the Quick Switcher) → run
   **Sandbox Smoke: boundary checks**, then **Sandbox Smoke: AI checks (slow)**.

They are two commands on purpose: `SandboxSession` bounds a whole command at 30s while
one mediated `ai` request may legitimately take 120s, so a slow model must not be able
to discard the boundary results that already passed.

## Reading the result

One error toast per command — `SMOKE …` for the boundary checks, `SMOKE-AI …` for the
AI ones. **The rejection is the report** — a sandboxed plugin
has no `ui` API, nothing consumes its `events.emit` yet, and the palette shows only
rejections, so throwing is the only channel that reaches the screen today.

| Field | Means |
| --- | --- |
| `cmd✓` | palette → host → sandbox → handler round-trip works |
| `storage✓(n)` | `storage` read/write/list/remove through `plugin_call`, `n` keys seen |
| `out✓` | reading `/etc/hosts` was refused for being OUTSIDE the open context — the needle excludes the "no context open" refusal, so this also proves step 3 was done |
| `list✓(n)` | `files:readonly` read of `VAULT_DIR` returned `n` entries |
| `ro✓` | a write was refused — the readonly grant does not admit it (any-of authz) |
| `state✓` | `<vault>/.baram/config.json` was refused as app state |
| `models✓(n)` | `ai.listModels()` through the host bridge |
| `ai✓(len=n:…)` | `ai.complete()` — **the path 3c-2c's review found was dead** |
| `stream✓(n tok/m ch)` | `ai.stream()` under the SAME options as `complete` |

`ai1`/`stream`/`ai2` run with identical options and are reported by size, because the
first live runs returned an empty-but-successful `complete`. Comparing the same API at
two positions is what separates "which API" from "which call" — the answer turned out
to be neither: it is intermittent, and it lives in the shared LLM path, tracked as
issue #304 (a non-`STOP` Gemini finish reason resolves as an empty success). An
`ai1`/`ai2` disagreement here is that issue, not a §260 regression.

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
