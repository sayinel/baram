---
title: "Quick start"
---


The fastest way to start a new plugin is to copy one of the two reference
examples in [`examples/plugins/`](https://github.com/sayinel/baram/tree/main/examples/plugins):

- [`examples/plugins/word-count/`](https://github.com/sayinel/baram/tree/main/examples/plugins/word-count) — **the sandboxed
  reference, and the one to copy.** A declared status-bar item written by an
  `editor:readonly` + `events` + `statusbar` plugin. It needs nothing from the main
  realm, which is the point.
- [`examples/plugins/ai-summary/`](https://github.com/sayinel/baram/tree/main/examples/plugins/ai-summary) — the **trusted**
  tier: Shadow-DOM sidebar panel + settings tab, `ai` + `storage`. Copy it only if you
  genuinely need arbitrary DOM; it is **not published to the registry**, because there
  is no declarative `sidebar` contribution yet and a trusted plugin cannot be sandboxed.

Two further folders are internal **test fixtures — not templates**. Both are single
hand-written files with no build step, and `plugin-release.yml` refuses to publish either:

- `examples/plugins/sandbox-smoke/` probes the sandboxed tier's brokered surface during a
  manual smoke run.
- `examples/plugins/malicious-fixture/` is the adversary: it holds two capabilities and
  asks for everything else, and CI asserts every call is refused. Useful to read as a
  catalogue of what the tier does **not** allow.

## The sandboxed tier's API differs

A plugin with `"trust": "sandboxed"` runs in its own isolated webview and gets a
narrower, data-only context. Two differences matter when writing one:

- **`files` paths are relative to a vault root you are never told.** `readFile("a.md")`,
  `listDir("")` for the vault root; an absolute path or a `..` is refused. Pass
  `{ context }` from a file event to keep a call aimed at the vault the event came from:
  ```js
  ctx.events.on("file:open", async ({ context, path }) => {
    const text = await ctx.files.readFile(path, { context });
  });
  ```
- **`editor` is markdown, and async.** `getMarkdown()` / `setMarkdown()` go through the
  app's own round-trip pipeline, so what you read is exactly what you can write back;
  `getSelection()` gives ProseMirror positions plus the text they cover, and
  `insertText()` types at the cursor. Every write is one undo step. Reads need `editor` or
  `editor:readonly`; writes need `editor`.

  ```js
  const before = await ctx.editor.getMarkdown();
  await ctx.editor.setMarkdown(`${before}\n\n---\n`);
  ```

  A document read does not travel in the response — the host parks it and the sandbox
  collects it — but that is invisible to you; `getMarkdown()` is just a promise.

  Two things worth designing around:
  - **`setMarkdown()` can refuse, and you should retry.** It parses off the main thread,
    and if the document changes while that runs — a tab switch, or the user typing a
    single character — it rejects with "the document changed" rather than overwriting the
    change. On a large document with an active typist this can fail repeatedly; that is
    deliberate, since the alternative is silently discarding what the user just wrote.
  - **Batch your inserts.** `insertText()` is one transaction, and ProseMirror groups undo
    by transaction, so inserting an AI stream token by token gives the user a thousand
    Cmd+Z presses — and each transaction costs the whole document to re-render, so the
    host throttles them on large files. Buffer and insert in chunks.

  Editor calls are metered by the work they cost, not by how often you call them: reading
  a scratch note is nearly free, reading a 10,000-line file repeatedly is not. If you see
  "document budget is exhausted", you are polling something you should be getting from
  `ctx.events` instead.

- **`settings` are the user's answers, and read-only.** Declare fields in
  `contributions.settings` and they render in your plugin's page under **Settings →
  Plugins**; read them with `await ctx.settings.getAll()`, which always returns one value
  per declared field, of the declared type.

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
    frames on purpose.)
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
   `include`/`path`, as both examples' `tsconfig.json` do).
2. Import types from there:

   ```typescript
   import type { ExtensionContext, StatusBarItem } from "./plugin-api";
   ```

3. Write `activate(context)` (and optionally `deactivate()`).
4. Build a single ESM bundle with esbuild:

   ```bash
   npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
     --external:@tiptap/core --external:@tiptap/pm
   ```

5. Dev-load the plugin without packaging anything: **Settings → Plugins →
   Developer → Load dev plugin folder**, then point the folder picker at your
   plugin directory. See [Local development loop](/baram/en/docs/plugin-dev/local-development-and-bundling/#local-development-loop).
