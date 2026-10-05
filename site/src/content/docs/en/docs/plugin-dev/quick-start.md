---
title: "Quick start"
---


The fastest way to start a new plugin is to copy one of the reference
examples in [`examples/plugins/`](https://github.com/sayinel/baram/tree/main/examples/plugins):

- [`examples/plugins/community-template/`](https://github.com/sayinel/baram/tree/main/examples/plugins/community-template) — **the
  one to copy.** A sandboxed status-bar plugin with an id outside the `baram-` prefix
  Baram reserves, and a release workflow that builds the ZIP the
  [community registry](/en/docs/plugin-dev/community-registry/) takes. Its README
  lists what to change.
- [`examples/plugins/word-count/`](https://github.com/sayinel/baram/tree/main/examples/plugins/word-count) — **the sandboxed
  reference** Baram publishes. A declared status-bar item written by an
  `editor:readonly` + `events` + `statusbar` plugin. It needs nothing from the main
  realm, which is the point. Its id starts with `baram-`, so change it in a copy.
- [`examples/plugins/bullet-threading/`](https://github.com/sayinel/baram/tree/main/examples/plugins/bullet-threading) — **the
  trusted reference.** A ProseMirror decoration plugin contributed through
  `tiptapExtensions`, plus a settings tab. Copy it when your plugin has to run *inside*
  the editor: that needs the main realm, so such a plugin is `trust: "trusted"` by
  construction — the sandboxed tier refuses `tiptapExtensions`. A copy loads from a folder
  only in a development build, and the community registry does not take it: it takes
  sandboxed plugins only.
- [`examples/plugins/ai-summary/`](https://github.com/sayinel/baram/tree/main/examples/plugins/ai-summary) — the **trusted**
  tier with arbitrary DOM: Shadow-DOM sidebar panel + settings tab, `ai` + `storage`.
  Copy it only if you genuinely need arbitrary DOM. It is **not in the release
  workflow's publish allowlist**; its 1.x line was withdrawn from the registry in
  v0.5.0, and there is still no declarative `sidebar` contribution. Like a copy of
  `bullet-threading/`, a copy loads from a folder only in a development build, and the
  community registry does not take it.

Two further folders are internal **test fixtures — not templates**. Both are single
hand-written files with no build step, and `plugin-release.yml` refuses to publish either:

- `examples/plugins/sandbox-smoke/` probes the sandboxed tier's brokered surface during a
  manual smoke run.
- `examples/plugins/malicious-fixture/` is the adversary: it holds two capabilities and
  asks for everything else, and CI asserts every call is refused. Useful to read as a
  catalogue of what the tier does **not** allow.

## The editor API (both tiers)

`ctx.editor` is the same in both tiers: markdown, and async. `getMarkdown()` / `setMarkdown()`
go through the app's own round-trip pipeline, so what you read is exactly what you can write
back. `getSelection()` gives positions, the selection's plain text, and a `ref`;
`insertMarkdown(md, { replace: ref })` replaces exactly that range, and `insertText()` types
plain text. Every write is one undo step. Reads need `editor` or `editor:readonly`; writes
need `editor`. Every method and refusal code is in
[Context: commands, editor, files, events](/en/docs/plugin-dev/context-commands-editor-files-events/#contexteditor-requires-editor-or-editorreadonly).

```js
const before = await ctx.editor.getMarkdown();
await ctx.editor.setMarkdown(`${before}\n\n---\n`);
```

In the sandboxed tier a document read does not travel in the response — the host parks it and
the sandbox collects it — but that is invisible to you; `getMarkdown()` is just a promise.

Three things worth designing around:

- **`setMarkdown()` can refuse, and you should retry.** It parses off the main thread, and if
  the document changes while that runs — the user typing a single character, or a switch to
  another markdown tab — it rejects with `code: "document-changed"` rather than overwriting
  the change. A tab switch still in progress, or one to a tab that is not a markdown
  document, rejects with `code: "surface-blocked"` instead. On a large document with an
  active typist this can fail repeatedly; that is deliberate, since the alternative is
  silently discarding what the user just wrote.
- **Batch your inserts.** Each `insertText()` or `insertMarkdown()` is its own undo step, so
  inserting an AI stream token by token gives the user a thousand Cmd+Z presses — and in the
  sandboxed tier an insert's charge is based on the size of the whole document, not only of
  what you insert, so on a large file a token-by-token stream runs out of budget. Buffer and
  insert in chunks.
- **Read, then replace with the `ref`.** An AI rewrite that takes seconds should keep the
  `ref` from `getSelection()` and pass it back: a write without it lands on whatever is
  selected *then*, which may be somewhere else entirely. The selection's `text` is plain, so a
  rewrite that should keep bold or links has to put them back in the markdown it passes.

In the sandboxed tier, editor calls are metered by the work they cost, not by how often you
call them: reading a scratch note is nearly free, reading a 10,000-line file repeatedly is
not. A write refused after its range was checked — a `ref` whose text changed, say — still
pays that range's length, so retrying a stale `ref` in a loop runs the budget down; read the
selection again instead. If a call is refused with `code: "budget"`, look for a read you are
polling that `ctx.events` could hand you instead, or for inserts you could batch. The trusted
tier has no such budget.

## The sandboxed tier's API differs

A plugin with `"trust": "sandboxed"` runs in its own isolated webview and gets a
narrower, data-only context. Three differences matter when writing one:

- **`files` paths are relative to a vault root you are never told.** `readFile("a.md")`,
  `listDir("")` for the vault root; an absolute path or a `..` is refused. Pass
  `{ context }` from a file event to keep a call aimed at the vault the event came from:
  ```js
  ctx.events.on("file:open", async ({ context, path }) => {
    const text = await ctx.files.readFile(path, { context });
  });
  ```
- **`settings` are the user's answers, and read-only.** Declare fields in
  `contributions.settings` and they render in your plugin's page under **Settings →
  Plugins**; read them with `await ctx.settings.getAll()`, which always returns one value
  per declared field, of the declared type. Here it is async; the trusted tier's `getAll()`
  returns the values directly.

  ```js
  const { prefix } = await ctx.settings.getAll();
  ctx.events.on("settings:changed", async () => {
    const next = await ctx.settings.getAll(); // the event carries no values
  });
  ```

  Things that follow from "the user's answers":
  - **There is no setter.** A value the user chose must not move underneath them. Use
    `ctx.storage` for state of your own.
  - **`settings:changed` carries nothing** — re-read. (The values are kept out of pushed
    frames on purpose.) It is gated on `settings`, not on `events`, in both tiers, and it
    is debounced so a field being typed into notifies you once the value settles.
  - **A value is resolved against your CURRENT manifest**, so if an update changes a
    field's type or drops a key, the plugin sees the new default rather than the old
    value. Renaming a key resets it; that is the trade for never handing you a `string`
    where your manifest says `number`.
  - At most 16 fields, and a string value is capped at 512 characters. Fields render only
    if the manifest also declares the `settings` capability.

- **`ui` is data, not DOM.** `ctx.ui.showNotification(message, type?)` (the host labels
  the toast with your plugin's name in its own badge, and rate-limits you to one every
  four seconds — the app has a single toast slot) and
  `ctx.ui.setStatusBarText(id, text)` for an item your manifest declared in
  `contributions.statusBar`. No `addStyle`, no panel `onMount(el)` — those need
  `"trust": "trusted"`.

Declared status-bar items are registered from the manifest before your plugin's code
runs — so they show up while the sandbox is still booting — and one with a `command` is
clickable. They are removed again if the load fails.

When your plugin finishes activating, the host delivers a synthetic `file:open` for the
file that is already open, if any. That way a plugin loaded at startup does not have to
wait for the user to switch tabs before it knows where it is.

Contribution ids (`commands[].id`, `statusBar[].id`, `settings[].key`, and the `command` a
status-bar item points at) must match `^[A-Za-z0-9_-]+$` and be unique within their
section; at most five status-bar items and sixteen settings fields may be declared, and a
settings `default` must have the type its field declares. The host namespaces them as
`<pluginId>.<command>` and `<pluginId>:sb:<item>`, so a `.` or `:` in the trailing part
would make those ids ambiguous.

A plugin project looks like this:

```
my-plugin/
  baram-plugin.json      # Manifest (required)
  src/index.ts           # Your source (TypeScript recommended)
  dist/index.mjs         # Built ESM bundle — this is what "main" points at
  plugin-api.d.ts         # Copied from examples/plugins/plugin-api.d.ts
  types.d.ts              # Copied from examples/plugins/types.d.ts
  package.json
  tsconfig.json
```

1. Copy `examples/plugins/plugin-api.d.ts` and `examples/plugins/types.d.ts`
   next to your source (or reference them directly via a relative
   `include`/`path`, as the examples' `tsconfig.json` files do).
2. Import types from there — `SandboxContext` for a sandboxed plugin, as the
   template does (a `trusted` plugin takes `ExtensionContext` instead):

   ```typescript
   import type { SandboxContext } from "../plugin-api";
   ```

3. Write `activate(context)` (and optionally `deactivate()`).
4. Build a single ESM bundle with esbuild:

   ```bash
   npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
   ```

5. Dev-load the plugin without packaging anything: **Settings → Plugins →
   Developer → Load dev plugin folder**, then point the folder picker at your
   plugin directory. On a release build, turn on **Developer mode** in that
   section first — the button stays hidden until you do — and give the plugin a
   `sandboxed` tier and an id that does not start with `baram-`. See
   [Local development loop](/en/docs/plugin-dev/local-development-and-bundling/#local-development-loop).
