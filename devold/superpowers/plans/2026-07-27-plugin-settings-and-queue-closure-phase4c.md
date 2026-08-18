# §260 Phase 4c — the tier gets configuration, and the shared queue closes

Issue #260, after Phase 4b merged (PR #321, `e2027b3`). Branch: `feat/plugin-settings-260`.

## Why this slice, and why not the rest of Phase 4

After 4b a sandboxed plugin can orient, show, and read/write the document. What it still
cannot do is take an answer from the user. Every real plugin needs one — which counter
format, which heading level, which prefix — and `contributions.settings` has been in the
manifest schema since Phase 1 **with nothing reading it**.

The deciding argument is Phase 6, the reference-plugin port. `baram-word-count` and
`baram-ai-summary` need exactly one thing that does not exist yet: **settings**. Document
transforms, `menu` mapping and declarative sidebar panels are not blockers for either, and
neither is a blocker for Phase 5's release-gate transition.

So this slice takes settings, and the one debt that *is* a Phase-5 blocker: the payload
paths that still enter tauri's app-global channel-data queue. 4b closed that for the
document and left two siblings named in its own PR body.

Deferred, with reasons rather than an ordering (see the end of this file): document /
selection transforms, `menu` mapping, declarative sidebar panels, `commands.execute` of app
commands.

## Half A — declarative `settings`

### A-D1. The value is the USER's, and the plugin cannot write it

`usePluginStore` has carried `pluginSettings: Record<pluginId, Record<key, unknown>>` —
persisted, cleaned up on uninstall — since §69. Its only consumer today is its own test
file. 4c is its first real user, so treat everything about it as unproven.

The plugin gets **read-only** access in v1:

- The field is the user's *answer* to a question the plugin asked in its manifest. A plugin
  that could write it could silently undo a choice the user made — turn a "send this
  document to my server" toggle back on — and no UI anywhere would show that it had moved.
- A plugin that needs mutable state of its own already has `storage`, which is per-plugin,
  isolated in Rust, and not presented to the user as settings.
- Cost, stated plainly: an author who wants a "remember my last choice" value writes it to
  `storage`, not to a settings field. Documented.

### A-D2. Resolved against the CURRENT manifest, never handed over as persisted

`resolvePluginSettings(declared, persisted)` — one function, used by the UI, by both tiers'
read paths, and by nothing else:

```
for each field DECLARED in the current manifest, in declaration order:
    persisted value, if `typeof` matches the declared type          → use it
    else the declared `default`, if its typeof matches               → use it
    else the type's zero (false / 0 / "")
strings   → clamped to MAX_SETTING_VALUE_CHARS (NOT control-char stripped — see below)
numbers   → finite only; NaN/±Infinity fall back like a type mismatch
keys NOT declared → dropped
```

AS BUILT, one divergence: control characters are **not** stripped from a value. The
destination is the plugin, and every path that renders plugin-supplied text in the app's own
chrome sanitises at its own boundary (the `label` does, because it reaches the settings
pane). Stripping a value would only make it differ from what the user typed.

Why not pass the persisted record through: a plugin **update** can change a key's type or
remove it. Passing it through would hand a plugin a `string` where its own manifest says
`number` (so `value.toFixed()` throws inside the sandbox, where the author cannot see it),
resurrect the stale value of a renamed key, and let the payload grow past anything the
manifest bounds. Dropping undeclared keys is what makes the manifest the payload's bound.

The persisted blob is not migrated or pruned on read — a value whose field disappears in
v2 and returns in v3 is still there. That is deliberate: settings survive an update that
temporarily drops a field, and `removePlugin` already clears the whole record on uninstall.

### A-D3. Values travel as a STAGED pull; the notification carries nothing

Reuse 4b's staging (`plugin_sandbox_stage` → `PluginOp::StagedRead`) rather than answering
in the response frame.

- `MAX_SETTING_FIELDS` (16) × a `MAX_SETTING_VALUE_CHARS` (512) string is ~9 KiB, already
  over tauri's 8 KiB channel-data threshold — and any per-field cap chosen to stay under it
  puts a behaviour change exactly on that boundary, which is where every bug in this class
  has lived (4b's `getSelection`, twice).
- The change notification is therefore **payload-free**: `settings:changed` says only that
  something changed, and the plugin pulls. That keeps values out of the *push* direction
  entirely — the direction with no cap and no platform exclusion (`Channel::send`).

### A-D4. `settings:changed` is gated on `settings`, not on `events`

4a's rule is that a plugin without `events` gets no delivered frames at all. This one
notification is the exception, and the reason it is safe to make one:

- It carries **no payload**, so there is nothing to leak by delivering it.
- `events` governs *app* events — what the user is doing (`file:open`, `file:save`,
  `editor:ready`). `settings:changed` is the settings feature notifying the plugin whose own
  configuration moved; requiring a second, unrelated capability for it would leave an author
  who declared `settings` wondering why their plugin never updates.

### A-D5. `label` is author text that reaches app chrome

Same class as the status-bar text 4a had to sanitise: it is rendered in the app's own
Settings UI, so it goes through `sanitizePluginText` with a length cap. A label with
newlines or 4,000 characters is a layout attack on the settings pane.

### A-D6. Validation lands in the commit that first reads the field

The carry-over from 4a, restated there for 4b and now due: `settings[].key` gets
`requireId` (so a key cannot contain `.` or `:` and collide with the namespacing rule),
`label` `requireString`, `type` the enum, `default`'s typeof must match `type`, duplicate
keys rejected, and the section capped at `MAX_SETTING_FIELDS`.

`menu` is still unread after this slice, so **the note survives**: whoever first reads
`menu[].command` adds `requireId` in the same commit.

## Half B — the last of the shared queue

### B-D1. Every broker result becomes a scalar

Tauri routes an `ipc::Channel` payload into the app-global `ChannelDataIpcQueue` when it is
≥8 KiB **and** its JSON starts with `{` or `[`; the queue is drained by the ACL-exempt
`FETCH_CHANNEL_DATA_COMMAND` with a guessable sequential id. `plugin_cmd.rs` has recorded
since 3c-2c that `files_list` and `storage_list` return arrays and `http_fetch` an object,
that `files_list` crosses 8 KiB on a directory of a few hundred notes, and that the fix was
"owed with Phase 4's document transforms".

The fix is not chunking. Return the value as a **JSON string** and the second half of
tauri's condition can never be satisfied — a scalar string serialises as `"…"`. The client
parses it back. No new command, no ACL change, no reassembly state machine, and no size
threshold anywhere in it.

AS BUILT, this is a **type** (`BrokerResult`) rather than the helper function the plan
assumed. A helper would have been a convention the next arm could skip with `json!(...)`,
and no test would notice — a Rust test can exercise the encoder without exercising the ARM,
which is precisely how 4b's central property came to be restated by its test instead of
executed (I1). `execute_op` returns the newtype, so an arm cannot express a bare array or
object at all. Verified by mutation: putting `json!` back in an arm fails to COMPILE.

### B-D2. `ai_complete` streams; `ai_list_models` is staged

The deferral named in 4b's own PR body. `ai_complete` answered inline and an LLM completion
routinely exceeds 8 KiB; the natural use of `ai` in this tier is "read the document,
summarise it", so `editor:readonly` + `ai` could route document-derived text into the same
queue that staging the document just closed.

AS BUILT, `complete` is **streamed rather than staged** — a third option the plan did not
consider. Two reasons, both discovered while writing it:

1. `createAIAPI.complete` is already "stream and accumulate the buffer" one layer down, so
   using the stream transport changes no policy and adds no state; the client accumulates
   and `ctx.ai.complete` is unchanged for the plugin.
2. A staged answer would hold the sandbox's SINGLE staged slot for the whole length of an
   LLM call, serialising every document read behind it — a real regression the staging
   design does not have for short reads.

It also inherits the stall timer's per-token restart, which an inline `complete` never had.

`ai_list_models` IS staged: it is an array, an Ollama install decides how long, and it is
fast enough that holding the slot costs nothing.

`ai_stream` is unchanged — tokens always rode individual `hostStreamToken` frames.

### B-D3. One stale comment, fixed on the way

`protocol.ts` still says `editor_get_selection` is "small by nature, so unlike
`editor_get_markdown` this one answers inline". 4b made it staged and metered; the comment
survived because nothing reads a comment. Same class as the four orphaned doc blocks that
produced `lint:doc-comments`.

## Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Manifest validation + caps for `settings` | `manifest.ts` |
| 2 | `resolvePluginSettings` + the store's validated read path | `plugin-settings.ts`(new), `stores/system/plugin.ts` |
| 3 | Settings form in the plugin detail view + i18n | `PluginSettingsForm.tsx`(new), `PluginDetail.tsx`, `i18n/` |
| 4 | `settings_read` host request + bridge + client API + `settings:changed` | `host-settings-bridge.ts`(new), `protocol.ts`, `host-request-router.ts`, `sandbox-client.ts`, `plugin-loader.ts` |
| 5 | Trusted-tier `ctx.settings` (sync, `settings`-gated) | `extension-context.ts`, `types.ts` |
| 6 | Stage `ai_complete` / `ai_list_models` | `host-ai-bridge.ts`, `sandbox-client.ts` |
| 7 | Broker results → scalars + client parse + the invariant test | `plugin_cmd.rs`, `sandbox-client.ts` |
| 8 | Fixture + docs + `types:plugin` regen | `examples/plugins/sandbox-smoke/*`, `docs/plugin-development.md` |

Gates per task: `npm test`, `npx tsc`; `cargo test`/`clippy`/`fmt`/`check --release` for
task 7. Whole-branch before review: `npm run lint` (incl. `types:plugin:check` and
`lint:doc-comments`), `npm test`, `cargo test`, `cargo clippy --all-targets -- -D warnings`,
`cargo fmt --check`, `cargo check --release`, `npm run build`.

## Verification plan

**Mutation-verify each new guard** — the practice that has caught a hollow test in every
phase since 3c:

- the type-mismatch fallback (persist a `string` for a `number` field → the plugin must get
  the default, not the string)
- the undeclared-key drop (persist a key the manifest no longer declares)
- the string clamp and the control-character strip
- the capability gate on `settings_read`
- the `settings` gate on the `settings:changed` delivery
- scalar-only broker results: make one op return an array again → the invariant test must go
  red
- staged `ai_complete`: the completion must not appear in the response frame

**Two wire-level assertions**, extending 4b's central property: the `hostResponse` for
`settings_read` and for `ai_complete` carry no payload. That is the property the whole
design is for, and the one a future refactor would silently break.

**Live smoke** (user-run — no CI job produces a real WebviewWindow, a real settings pane, or
a real persisted config):

1. declare a boolean, a number and a string field → all three appear in the plugin's detail
   view with their defaults
2. edit each → the plugin reports the new values (staged pull, so also a check that the
   pull path works for a second consumer of the slot)
3. change one while the plugin is running → `settings:changed` fires and the re-read is
   fresh
4. a plugin **without** `settings` is refused, distinguishably
5. restart the app → values persist; uninstall → values are gone
6. `files.listDir("")` on a vault of a few hundred notes still returns the right names
   (B-D1's client-side parse, on the op that actually crosses 8 KiB)

## Deferred, with reasons

- **Document / selection transforms.** A separate slice, not an ordering choice: it needs a
  new bidirectional op (push the input, pull the result), an apply-as-one-transaction path,
  the document-identity race guard 4b landed, and a bounded wait for a plugin that never
  answers. That is 4b-sized. Its value over `editor` + a command is real but narrow — the
  host applies the result, so a transform needs no write grant at all — and it is not a
  blocker for Phase 5 or 6.
- **`menu` mapping.** Baram's menu is built in Rust with static ids (`menu.rs`) and there is
  no general editor context menu, so "map `menu`" means dynamic native submenu items,
  another host-only command with its ACL, and the locale path — for a surface the command
  palette already covers. Deliberately not done cheaply-but-wrongly.
- **Declarative sidebar panels.** Not in the ADR's v1 contribution schema at all. A panel a
  sandboxed plugin can fill needs a declarative widget language; arbitrary DOM stays
  trusted-tier (`registerSidebarPanel`).
- **`commands.execute` of app commands.** A privilege question, as the ADR says: a sandbox
  executing arbitrary app commands routes around every capability. It needs an allowlist
  decision, which belongs with whoever needs the first entry on it.
