# Sandbox Smoke (§260 Phase 3c-3 / 4a / 4b)

An internal fixture, not a real plugin: it exercises everything a **sandboxed** plugin
can reach and reports the outcome through `ctx.ui`. Headless CI cannot create a real
`WebviewWindow`, a real toast, or a real vault, so this is the only way to verify that
the sandboxed runtime works outside unit tests.

## What it costs you

The **AI** command sends three real LLM requests (`complete`, `stream`, `complete`) plus
a `listModels` to whichever provider you have configured, using your key. The prompt is
one sentence and `maxTokens` is 64, so the spend is negligible — but it is not zero, and
the prompt does leave your machine. The **boundary** command costs nothing: it reads at
most the file you already have open.

## Run it

1. Start the app with plugins enabled:
   ```sh
   VITE_ENABLE_PLUGINS=1 npm run tauri dev
   ```
2. Open a vault folder (the brokered file ops are deny-by-default until a folder or file
   context is open — that is the §88 rule, not a plugin rule), then open a note in it.
3. Settings → Plugins → **Add dev folder** → pick `examples/plugins/sandbox-smoke`.
   It should install and show the **sandboxed** trust badge.
4. Enable it. A hidden `plugin-baram-sandbox-smoke` webview is created and the plugin's
   bundle is imported from a `blob:` URL. **Two status-bar items appear immediately** —
   they come from the manifest, before any plugin code runs.
5. Click the **🧪 smoke** status-bar item, or run **Sandbox Smoke: boundary checks** from
   the command palette (**`Cmd+P`** — `Cmd+K` is the Quick Switcher). Then run
   **Sandbox Smoke: AI checks (slow)**.

No path to configure: since Phase 4a a sandboxed plugin's paths are relative to a vault
root it is never told, and it learns which file you are on from a delivered `file:open`
event. (Earlier versions needed a hand-edited absolute `VAULT_DIR`.)

The two commands are separate on purpose: `SandboxSession` bounds a whole command at 30s
while one mediated `ai` request may legitimately take 120s, so a slow model must not be
able to discard boundary results that already passed.

## Reading the result

Each command reports twice: an attributed **toast** (`Sandbox Smoke: SMOKE …`) and the
**🧪 status-bar item**, which keeps the line after the toast fades. The `📄` item shows
the vault-relative path the sandbox was told about.

| Field | Means |
| --- | --- |
| `cmd✓` | palette → host → sandbox → handler round-trip works |
| `storage✓(n)` | `storage` read/write/list/remove through `plugin_call`, `n` keys seen |
| `evt✓(n)` | the host delivered `n` file events, carrying a context id + relative path |
| `list✓(n)` | `listDir("")` — the context ROOT, with no path supplied — returned `n` entries |
| `read✓(nb)` | the file the event named read back through the context it named |
| `abs✓` | an absolute path (`/etc/hosts`) was refused as not relative — this tier cannot express one |
| `dotdot✓` | `../../../etc/hosts` was refused the same way |
| `ro✓` | a write was refused — the readonly grant does not admit it (any-of authz) |
| `state✓` | `.baram/config.json` was refused as app state, inside the vault |
| `md✓(nb)` | `editor.getMarkdown()` — the document, delivered through the STAGED pull rather than in a frame |
| `sel✓(a-b:nb)` | `editor.getSelection()` — ProseMirror positions plus the text they cover |
| `ro-md✓` / `ro-ins✓` | both writes refused: the fixture holds `editor:readonly`, so the any-of gate admits the reads above and nothing else |
| `models✓(n)` | `ai.listModels()` through the host bridge |
| `ai1✓(len=n:…)` | `ai.complete()` — **the path 3c-2c's review found was dead** |
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

Also check, by eye:

- the toast carries a **`Sandbox Smoke` badge** next to the message — the host renders
  that as its own element from the manifest name, so a plugin cannot write a line that
  reads as the app itself (a plugin that named itself "Baram" would get a *badge* saying
  Baram, never an unbadged app-looking toast);
- the sandbox console logs one `ui_status_bar refused` for the item the fixture
  deliberately does not declare (`not-declared`);
- opening another note updates the `📄` item.

## Expected noise, not failures

- A CSP refusal for `ws://localhost:1420/` in the sandbox realm. Vite's HMR socket is
  blocked there on purpose (`connect-src ipc: http://ipc.localhost`).
- `ai✗` with a provider/key/privacy-mode message if no model is configured — that is
  the host's shared AI policy refusing, which still proves the bridge works. Configure
  a provider and re-run to see `ai1✓`.
- Running both commands within four seconds of each other: the second toast is refused
  ("limited to one every 4000ms"), by design — the app has a single toast slot and that
  bound is deliberately longer than a toast's own lifetime. The status-bar item still
  carries the line.

## Still missing (Phase 4c)

Document/selection **transform** contributions, declarative `settings`, `menu` mapping,
and sidebar panels. A sandboxed plugin can now orient itself, report, and read or change
the document.
