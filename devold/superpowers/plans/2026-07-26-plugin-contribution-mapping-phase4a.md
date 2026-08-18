# §260 Phase 4a — contribution mapping: orient & show

Issue #260, after Phase 3 completed (PR #303). Branch: `feat/plugin-contribution-mapping-260`.

## Why this slice

Phase 3 gave the sandboxed tier a real boundary. The 3c-3 live smoke then showed the
tier is **enforced but not yet usable**, for two reasons that are independent of the
boundary:

1. **It cannot learn a path.** `activate` carries only `pluginId`; `SandboxContext`
   exposes no vault or plugin path; `SandboxSession.deliverEvent` exists and nothing
   calls it. A `files`-granted plugin therefore has nothing to pass to `readFile`.
   The smoke fixture had to hard-code an absolute `VAULT_DIR` — which is exactly why
   a personal path once shipped to a public repo.
2. **It cannot show anything.** No `ui`, nothing consumes `events.emit`, and
   `CommandPalette` discards a resolved command value while toasting a rejection —
   so the fixture reports its results **by throwing**.

Both are Phase 4 work and both are prerequisites for any real sandboxed plugin, so
they make one coherent unit. Everything else the ADR lists for Phase 4 (`editor` ops,
document transforms, `settings` schema, `menu`, `commands.execute` of app commands,
declarative sidebar panels) is deferred to 4b — see the end of this file.

## Design

### D1. Sandbox paths are vault-relative — absolute paths cannot be expressed

Today `files_read {path}` takes whatever string the plugin sends and containment-checks
it. To make that usable the host would have to *disclose the vault root*, which hands
every `files` plugin the user's home directory and username for free.

Instead: **the sandboxed tier's path space is relative to a vault root it never sees.**

```
files_read { context?: string, path: "notes/a.md" }
   ↓ Rust
context = op.context ?? ContextManager::active_id()      # named, else active vault
root    = ContextManager::list() → the entry with that id
joined  = root.join(path)                                 # refuse absolute `path`
resolved = resolve_canonical(joined)
ensure_path_in_vault(resolved)  +  reject_app_state_path(resolved)   # unchanged, defense in depth
```

Properties:

- A sandbox **cannot name a file outside a registered context**, because it cannot
  write an absolute path at all (refused) and `..` cannot survive
  canonicalize + `ensure_path_in_vault`.
- No absolute path crosses the boundary in either direction — not in an argument, not
  in an event payload, not in an error message.
- `listDir("")` is the vault root, so a plugin needs no bootstrap path whatsoever.
- The existing checks stay exactly where they are. This narrows the input domain; it
  does not replace the vault rule with a new one.

Cost, stated plainly: `FilesAPI` keeps its *shape* but the sandboxed tier's
interpretation of `path` now differs from the trusted tier's (absolute). 3c-2c
deliberately shared the shape so file code would be tier-portable; that goal is
partly given up here. It is the right trade — the alternative is disclosing the vault
root to every plugin that wants to read one note — and `context` is optional so the
common single-vault plugin is unaffected.

### D2. Events reach the sandbox, with relative paths

`emitPluginEvent` (host) already fans `editor:ready` / `file:open` / `file:save` out to
trusted plugins. Add a sandbox bridge:

```
notifyFileOpen(absolutePath)  →  emitPluginEvent("file:open", absolutePath)   # trusted, unchanged
                              →  sandboxEventBridge                            # NEW
                                    ├─ requires the `events` capability
                                    ├─ absolute → {context, path} relative, or DROP
                                    └─ session.deliverEvent(event, [payload])
```

- Gated on `events`. A plugin without it gets no frames at all (not "empty" frames).
- A file inside no registered context (§89 single-file mode) is **dropped**, not
  degraded to an absolute path. Silent by design: the alternative leaks the path.
- **Late-load replay:** right after `activate` resolves, if a file is currently open the
  host delivers one synthetic `file:open`. Without it, a plugin that loads after the
  user opened a file waits for the next tab switch to learn anything — the normal case
  on startup. Documented as a replay, not a real user action.

### D3. `ui.showNotification` — the reporting channel, attributed and bounded

Host-mediated (`SandboxHostRequest`), so it rides the 3c-2a transport and needs no new
Tauri command or ACL change.

- **No capability required**, matching the trusted tier (where `showNotification` is
  the one `UIAPI` method with no `require(...)`). A capability nobody declares would
  leave the tier mute, which is the defect being fixed.
- **Attributed by the host:** the toast text is `` `${pluginName}: ${message}` ``. A
  plugin must not be able to render a message that looks like the app speaking —
  "Baram: your vault is corrupted, paste your key here" is a phishing surface.
- **Sanitised:** control characters stripped, capped at 200 chars.
- **Rate-limited to 1 per 2 s per plugin, host-side.** The app's toast slot is
  *single* (`showToast` replaces `toast`), so an unbounded plugin could permanently
  clobber the app's own error toasts. Rust's `RateClass::Transport` (300/150 s) bounds
  the pipe but not this.
- Returns `void` to the plugin; the underlying request's rejection is logged inside the
  sandbox, never left as an unhandled rejection.

### D4. Declarative status bar + `ui.setStatusBarText`

`manifest.contributions.statusBar` is Phase-1 schema that nothing has ever read.

- At load the host registers each declared item into `usePluginUIStore` — **no plugin
  code runs**, so an item appears even before/without activate.
- `ui.setStatusBarText(id, text)` updates one, gated on `statusbar`. The host resolves
  `id` against *this plugin's declared items* and namespaces it (`${pluginId}:sb:${id}`),
  so a plugin can neither invent an item nor touch another plugin's.
- If an item declares `command`, clicking it runs that command through the existing
  handler registry. `PluginStatusBarItems` currently renders a `cursor-default` span;
  it gains a button branch when `command` is present (this benefits the trusted tier
  too, which had no clickable item at all).
- Same sanitisation as the toast; the status bar is persistent, so an over-long or
  newline-bearing string is a layout attack.

### D5. Fixture

`examples/plugins/sandbox-smoke/` stops reporting by throwing:

- results go to a status-bar item + a toast,
- `VAULT_DIR` and the `out✓` absolute-path probe are **deleted** — with D1 there is no
  absolute path to probe. The boundary check becomes "an absolute path is refused" and
  "`..` is refused", which is stronger and needs no user configuration.
- it shows the active file (relative) in the status bar, proving D2 end-to-end.

## Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Rust: relative-path resolution for `files_*` | `plugin_cmd.rs`, `authorizer.rs`(op shape), `context/manager.rs`(root lookup helper) |
| 2 | TS: op shape + `FilesAPI` interpretation + protocol frames | `plugin-op.ts`, `protocol.ts`, `sandbox-client.ts` |
| 3 | Event bridge + late-load replay | `sandbox-event-bridge.ts`(new), `plugin-lifecycle.ts`, `plugin-loader.ts` |
| 4 | `ui` host requests (notify + status bar) | `host-ui-bridge.ts`(new), `sandbox-client.ts`, `host-ai-bridge.ts`→shared dispatch |
| 5 | Declarative status-bar registration + click | `plugin-loader.ts`, `PluginStatusBarItems.tsx` |
| 6 | Fixture + docs + `types:plugin` regen | `examples/plugins/sandbox-smoke/*`, `docs/plugin-development.md` |

Gates per task: `npm test`, `npx tsc`, `cargo test`/`clippy`/`fmt` for Rust tasks.
Whole-branch gates before review: `npm run lint` (includes `types:plugin:check`),
`npm test`, `cargo test`, `cargo clippy --all-targets`, `cargo fmt --check`, `npm run build`.

## Verification plan

Unit tests are structurally blind to this phase's two riskiest properties — a path
that escapes the vault, and a frame the real validator drops — so:

- **Mutation-verify every new guard** (the practice that has caught a hollow test in
  each of the last two phases). Specifically: delete the absolute-path refusal, the
  `..` refusal, the `events` gate, the item-ownership check, and the toast limiter one
  at a time; each must turn a test red.
- **Every new protocol union member gets a validator entry in the same commit.**
  `hostRequest` shipping dead in 3c-2c came from exactly this gap; the discriminant-keyed
  record makes TS complain, so the check is: does `npx tsc` fail when the entry is
  removed?
- **Live smoke** (user-run, `VITE_ENABLE_PLUGINS=1 npm run tauri dev`), because no CI
  job can produce a real WebviewWindow, a real toast, or a real vault:
  1. status-bar item appears with the plugin's name, before any command runs
  2. open a file → the item shows its vault-relative path
  3. run the command → toast reports `rel✓ list✓ abs-refused✓ dotdot-refused✓ events✓`
  4. click the status-bar item → its command runs
  5. reload + remove still clean (3c-3 regression)

## Carried into 4b — do not lose these

- **`menu[].command` and `settings[].key` are still unvalidated.** `validateContributions`
  checks them only as arrays of objects, deliberately (nothing reads them yet, and a shape
  asserted now would freeze an unsettled design). But 4b will build
  `${pluginId}.${command}` from `menu[].command` exactly as the status bar does, and
  `CONTRIBUTION_ID` exists to keep separators out of that position — so whoever first
  reads those fields adds `requireId`/`requireString` in the SAME commit.
- **`replayCurrentState` is a second translation site.** It hardcodes `"file:open"` and
  builds its own `PluginFileEvent` instead of going through `EVENT_PAYLOADS`. No leak
  today (it only ever sends the translated shape), but a change to that event's rule would
  not reach it.
- **`ui` shares the 4-slot in-flight budget with `ai`.** A plugin with four live `ai`
  streams cannot show a toast — including the one reporting an AI failure. The bound
  exists to limit provider cost, which `ui` does not incur.
- **A plugin toast can still replace a mid-display app toast** within its 4s allowance.
  The real fix is a queue or a second slot, which is app-wide UX work.

## Deferred to 4b (do not creep)

`editor` get/set/selection/insert + document transform (needs the ≥8 KiB channel-queue
chunking that 3c-2c left owed), `settings` declarative form + value storage, `menu`
mapping, `commands.execute` of *app* commands (a privilege question of its own — a
sandbox executing arbitrary app commands would route around every capability),
declarative sidebar panels.
