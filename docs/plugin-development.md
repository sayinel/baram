# Baram Plugin Development Guide

## Overview

A Baram plugin is a directory containing a manifest (`baram-plugin.json`) and
a single ESM bundle (typically `dist/index.mjs`). The bundle exports an
`activate(context)` function (and optionally `deactivate()`); the host calls
`activate` with a capability-gated `ExtensionContext` object that is the
plugin's only way to touch the app.

Every plugin declares one of two tiers in its manifest, and the tier decides what
"capability" means:

- **`"trust": "sandboxed"`** — the default, and what you should write. The plugin runs in
  its own isolated webview with no access to the app's JavaScript, and every privileged
  operation goes through a Rust broker that authorizes the call against the plugin's
  granted capabilities. Here the capability list is a **real boundary**.
- **`"trust": "trusted"`** — the same JavaScript context as the editor, Obsidian's model.
  Necessary for `tiptapExtensions`, which need direct access to the live ProseMirror
  `Schema` that an isolated plugin cannot be given. Here the capability system is only an
  **API gate**: the plugin can reach around it, so the list describes intent rather than
  limiting anything. Installing one requires an explicit acknowledgement of exactly that.

Write sandboxed unless you are contributing a Tiptap extension or DOM-mounted UI. See
[Trust model & security](#trust-model--security) before installing or authoring anything
sensitive.

## Quick Start

The fastest way to start a new plugin is to copy one of the two reference
examples in [`examples/plugins/`](../examples/plugins/):

- [`examples/plugins/word-count/`](../examples/plugins/word-count/) — **the sandboxed
  reference, and the one to copy.** A declared status-bar item written by an
  `editor:readonly` + `events` + `statusbar` plugin. It needs nothing from the main
  realm, which is the point.
- [`examples/plugins/ai-summary/`](../examples/plugins/ai-summary/) — the **trusted**
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

### The sandboxed tier's API differs

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
   plugin directory. See [Local development loop](#local-development-loop).

## Manifest (`baram-plugin.json`)

```json
{
  "id": "my-word-count",
  "name": "Word Count",
  "description": "Displays word and character count in the status bar",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "dist/index.mjs",
  "engines": {
    "baram": ">=0.5.0"
  },
  "trust": "sandboxed",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "contributions": {
    "statusBar": [{ "id": "count", "text": "— words" }]
  },
  "keywords": ["word", "count", "statistics"],
  "repository": "https://github.com/user/my-word-count",
  "homepage": "https://example.com"
}
```

### Required Fields

| Field           | Type      | Description                                                                |
| --------------- | --------- | -------------------------------------------------------------------------- |
| `id`            | string    | Unique identifier. Lowercase letters, digits, hyphens only.                |
| `name`          | string    | Human-readable display name                                                |
| `description`   | string    | Short description                                                          |
| `version`       | string    | Semver version                                                             |
| `author`        | string    | Author name                                                                |
| `license`       | string    | SPDX license identifier                                                    |
| `main`          | string    | Entry point file, relative to the plugin directory (e.g. `dist/index.mjs`) |
| `engines.baram` | string    | Minimum Baram version, written `>=X.Y.Z` — see [Version floor](#version-floor)  |
| `capabilities`  | string\[] | Required permissions — see [Capabilities](#capabilities)                   |

### Optional Fields

| Field              | Type      | Description                                                                                           |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------- |
| `dependencies`     | string\[] | Other plugin IDs this plugin depends on                                                               |
| `tiptapExtensions` | object\[] | Tiptap extensions exported by this plugin — see [Tiptap Extension plugins](#tiptap-extension-plugins) |
| `repository`       | string    | Source code URL                                                                                       |
| `homepage`         | string    | Documentation URL                                                                                     |
| `icon`             | string    | Emoji icon for the marketplace/dev-list                                                               |
| `keywords`         | string\[] | Search keywords                                                                                       |

### Version floor

`engines.baram` is the oldest Baram your plugin runs on, and it is **enforced**: Baram
refuses to install or update to a version whose floor it does not meet, and says which
version is needed. Getting it wrong is not cosmetic — declaring a floor higher than
necessary makes your plugin uninstallable for users who could have run it.

Write it as `>=X.Y.Z`, with all three numbers:

```json
{ "engines": { "baram": ">=0.5.0" } }
```

That is the only form both Baram and the publish workflow read. Anything else — `^0.5.0`,
`~0.5`, `0.5.0`, a two-bound range — is treated by the app as *no floor stated*, so it
silently stops protecting your users; the publish workflow rejects it outright, so a
first-party release never ships that way. A prerelease build (`0.6.0-beta.1`) does not
satisfy `>=0.6.0`, per semver.

## Capabilities

Plugins must declare every capability they need in the manifest. Users
approve these at install time (registry installs) or implicitly by choosing
to load a dev folder (see [Trust model & security](#trust-model--security)).
Accessing an API whose capability was not declared throws a clear error
("Plugin requires `"X"` capability to access …") instead of silently no-oping
— the context hands back a denied proxy for any ungranted API.

| Capability        | Description                             | Sensitivity   |
| ----------------- | --------------------------------------- | ------------- |
| `commands`        | Register and execute editor commands    |               |
| `editor`          | Read and modify document content        |               |
| `editor:readonly` | Read document content (no modification) |               |
| `events`          | Listen to editor events                 |               |
| `files`           | Read and write files in the vault       | sensitive     |
| `files:readonly`  | Read files in the vault (no writing)    |               |
| `sidebar`         | Add panels to the sidebar               |               |
| `statusbar`       | Display items in the status bar         |               |
| `settings`        | Declare options in the settings screen  |               |
| `ai`              | Access AI/LLM features                  | **sensitive** |
| `network`         | Make network requests                   | **sensitive** |
| `storage`         | Use a plugin-private key/value store    | sensitive     |
| `viewer`          | Register custom file-type viewers       |               |

`ai` and `network` are the highest-sensitivity capabilities — see
[Trust model & security](#trust-model--security) for exactly what they allow.
`files` and `storage` are also flagged because they touch data outside the
plugin's own memory (vault files / a persistent on-disk store), even though
they're vault- or plugin-scoped rather than globally unrestricted.

## Entry Point

The entry point (`main` in the manifest) must be a single ESM bundle
exporting `activate` and optionally `deactivate`:

```javascript
export function activate(context) {
  // Called when the plugin is loaded. `context` is the capability-gated
  // ExtensionContext — see below for the full API.
  context.commands.register("sayHello", () => {
    context.ui.showNotification("Hello from my plugin!");
  });

  context.events.on("file:save", (filePath) => {
    console.log("File saved:", filePath);
  });
}

export function deactivate() {
  // Called when the plugin is unloaded. Anything registered via
  // context.subscriptions (commands, event listeners, status-bar items,
  // styles, panels, tabs) is disposed automatically — you only need this
  // hook for cleanup that isn't tracked as a Disposable (e.g. timers).
}
```

**`deactivate` is a trusted-tier hook only.** A sandboxed plugin is never called back:
unloading it destroys its whole webview realm, so timers, listeners and declared items all
go with it. Exporting one there is dead code that reads like a lifecycle hook — the
`word-count` reference plugin deliberately has none.

## ExtensionContext API

The `context` object passed to `activate()` exposes these APIs, each gated by
the capability (or capabilities) declared in the manifest. Signatures below
are taken verbatim from `src/plugins/types.ts` (published as
[`examples/plugins/plugin-api.d.ts`](../examples/plugins/plugin-api.d.ts)).

### `context.commands` (requires `commands`)

```typescript
interface CommandRegisterOptions {
  paletteVisible?: boolean;
  title?: string;
}

register(
  id: string,
  handler: (...args: unknown[]) => unknown,
  opts?: CommandRegisterOptions,
): Disposable;

execute(id: string, ...args: unknown[]): Promise<unknown>;
```

Registering a command with `opts.paletteVisible === true` or any `opts.title`
surfaces it in the Command Palette — see
[Command Palette integration](#command-palette-integration).

### `context.editor` (requires `editor` or `editor:readonly`)

```typescript
getContent(): string;                       // plain text, not Markdown/HTML
setContent(content: string): void;          // editor only — throws under editor:readonly
getSelection(): { from: number; to: number; text: string };
insertText(text: string): void;             // editor only — throws under editor:readonly
```

`getContent()` returns the document's plain text (`editor.getText()`
internally) — not Markdown source and not HTML.

### `context.files` (requires `files` or `files:readonly`)

```typescript
readFile(path: string): Promise<string>;
writeFile(path: string, content: string): Promise<void>;  // files only — throws under files:readonly
listDir(path: string): Promise<string[]>;                  // resolves to entry names, not full paths
```

### `context.events` (requires `events`)

```typescript
on(event: string, handler: (...args: unknown[]) => void): Disposable;
emit(event: string, ...args: unknown[]): void;
```

The only events the host currently emits are `"editor:ready"`, `"file:open"`,
and `"file:save"` (the `PluginEventName` union type). **There is no
per-keystroke or live document-change event yet** — if you need to react to
edits, recompute on `editor:ready`/`file:open`/`file:save` instead of polling
or expecting a `"editor:change"`-style event (it does not exist). See the
word-count example for the pattern.

`"file:open"` fires once the opened file's content is actually loaded into the
editor — not at the moment the tab opens — so for markdown files
`ctx.editor.getContent()` reads the right document inside the handler. It also
fires when switching to a tab that was already open (not just on first open).
For non-markdown files the event still fires after the source editor loads,
but `ctx.editor` wraps the ProseMirror (markdown) editor, so `getContent()`
does not reflect code-file content.

### `context.ui`

```typescript
showNotification(message: string, type?: "error" | "info" | "warning"): void;

showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
// StatusBarItem = { setText(text: string): void; dispose(): void }

addStyle(css: string): Disposable;

addSidebarPanel(opts: PluginSidebarPanelOptions): Disposable;
addSettingsTab(opts: PluginSettingsTabOptions): Disposable;
// PluginSidebarPanelOptions = { id: string; title: string; icon?: string;
//   onMount(el: HTMLElement): void; onUnmount?(el: HTMLElement): void }
// PluginSettingsTabOptions  = { id: string; title: string;
//   onMount(el: HTMLElement): void; onUnmount?(el: HTMLElement): void }

registerFileViewer(opts: PluginFileViewerOptions): Disposable;
// PluginFileViewerOptions = { id: string; extensions: string[];
//   onMount(el: HTMLElement, ctx: PluginFileViewerContext): void;
//   onUpdate?(el: HTMLElement, ctx: PluginFileViewerContext): void;
//   onUnmount?(el: HTMLElement): void }
// PluginFileViewerContext = { assetUrl: string; filePath: string;
//   refreshKey: number; zoomLevel: number }
```

`context.ui` itself is available whenever the manifest declares `sidebar`,
`statusbar`, `settings`, or `viewer` (any one unlocks the object), but each
method has its own per-method gate:

| Method               | Requires capability                                    |
| -------------------- | ------------------------------------------------------ |
| `showStatusBarItem`  | `statusbar`                                            |
| `addSidebarPanel`    | `sidebar`                                              |
| `addSettingsTab`     | `settings`                                             |
| `registerFileViewer` | `viewer`                                               |
| `showNotification`   | any of `sidebar` / `statusbar` / `settings` / `viewer` |
| `addStyle`           | any of `sidebar` / `statusbar` / `settings` / `viewer` |

Notes:

- `showStatusBarItem` returns a `StatusBarItem` object — call `.setText(...)`
  to update the text in place, `.dispose()` to remove it. Its second
  parameter is `align: "left" | "right"` and defaults to `"right"`.
- `addStyle(css)` injects a `<style>` tag into `document.head` (light DOM).
  It **cannot** style content inside a Shadow-DOM sidebar panel or settings
  tab — see [Shadow-DOM UI isolation](#shadow-dom-ui-isolation).
- `addSidebarPanel` / `addSettingsTab` both mount into an isolated Shadow-DOM
  subtree via `onMount(el)` — see the next section.
- `registerFileViewer` makes the app open files with the listed extensions in
  your viewer instead of the code editor. The host hands `onMount` a plain
  (light-DOM) element plus a context: `assetUrl` is the file served over the
  `asset:` protocol (already cache-busted with `refreshKey`), and `zoomLevel`
  is the shared editor zoom (Cmd+= / Cmd+- / Cmd+0, Ctrl+wheel) — scaling
  your content with it is your viewer's job. `onUpdate` fires when the
  context changes while mounted (zoom, save, external reload). For **text**
  extensions the app keeps its preview ↔ source toggle: your viewer renders
  the preview side, CodeMirror the source side. **Binary** extensions are
  viewer-only, and the app's binary guards (no UTF-8 reads, no text saves)
  apply whether or not your plugin is enabled. The built-in `media-viewer`
  plugin (`src/plugins/builtin/media-viewer.ts`) is the reference
  implementation.

### `context.ai` (requires `ai`)

```typescript
interface AICompleteOptions {
  maxTokens?: number;
  systemPrompt?: string;
}
interface AIModel { id: string; name: string; }

complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
stream(prompt: string, opts: AICompleteOptions, onToken: (token: string) => void): Promise<void>;
listModels(): Promise<AIModel[]>;
```

`complete`/`stream`/`listModels` all use the **user's own configured AI
provider, model, and API key** (whatever is set in Settings → AI) — a plugin
cannot supply its own key or provider. See
[Trust model & security](#trust-model--security) for what privacy mode does
and does not gate here.

### `context.network` (requires `network`)

```typescript
interface PluginFetchInit {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}
interface PluginFetchResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
```

This is a Rust-side `reqwest` proxy (it bypasses the browser's CORS
restrictions), **not** the browser `fetch`. Only `http`/`https` URLs are
allowed; the response body is always a UTF-8 string (binary responses are
lossily decoded, not usable as bytes); duplicate response headers collapse
to whichever value `reqwest` iterates last. See
[Trust model & security](#trust-model--security) for the full egress and
size/timeout policy.

### `context.storage` (requires `storage`)

```typescript
read(key: string): Promise<string | null>;
write(key: string, value: string): Promise<void>;
list(): Promise<string[]>;
remove(key: string): Promise<void>;
```

A simple string key/value store, one directory per plugin. See
[Trust model & security](#trust-model--security) for where it lives and its
guarantees (or lack thereof).

### `context.settings` (requires `settings`)

```typescript
getAll(): Record<string, boolean | number | string>;
```

The user's answers to the fields your manifest declares in
`contributions.settings`, rendered as a form in your plugin's page under
**Settings → Plugins**. One entry per declared field, always of the declared
type; keys your current manifest does not declare are not returned.

Synchronous here and `Promise`-returning in the sandboxed tier — otherwise the
same function, resolved the same way, so the same plugin source works in both.
There is no setter in either tier: a value the user chose is not the plugin's to
move. Use `context.storage` for state of your own.

```javascript
const { prefix = "»" } = context.settings.getAll();
```

### `context.subscriptions`

`Disposable[]` — every `Disposable` returned by `commands.register`,
`events.on`, `ui.showStatusBarItem`, `ui.addStyle`, `ui.addSidebarPanel`, and
`ui.addSettingsTab` is pushed here automatically and disposed when the
plugin is unloaded (reload, remove, or app shutdown). You don't need to
track these yourself.

## Shadow-DOM UI isolation

`addSidebarPanel` and `addSettingsTab` don't render your markup directly
into the app's DOM tree. Instead, the host attaches an **open Shadow DOM**
to a mount point and calls your `onMount(el)` with a `<div>` that lives
_inside_ that shadow root. This isolates the panel's CSS from the rest of
the app (and vice versa) — the app's global stylesheets do not leak in, and
whatever CSS the panel injects does not leak out.

Practical consequences:

- **Style shadow content by appending a `<style>` element to `el` inside
  `onMount`** — not with `context.ui.addStyle()`, which targets
  `document.head` (light DOM) and never reaches shadow content. Both example
  plugins do this:

  ```typescript
  function appendStyle(el: HTMLElement, css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    el.appendChild(style);
  }

  onMount(el) {
    appendStyle(el, PANEL_STYLE);
    // ...build your panel's DOM under el
  }
  ```

- **CSS custom properties inherit across the shadow boundary.** The app's
  design-token variables (`var(--color-text-default)`,
  `var(--color-border-default)`, `var(--color-bg-secondary)`, etc.) are
  still visible inside your shadow root, so you can theme your panel against
  the live app theme without duplicating token values. See
  `examples/plugins/ai-summary/src/index.ts` for a full example that themes
  entirely off inherited custom properties.
- `onMount(el)` receives the shadow root's inner content `<div>`, not the
  `ShadowRoot` object itself (a `ShadowRoot` has no `.style`/`.classList`).
  `onUnmount(el)`, if provided, is called before the host removes the
  subtree — use it for teardown that isn't a tracked `Disposable` (timers,
  manual event listeners you added directly to `el`'s descendants, etc).

## Command Palette integration

Passing `opts.title` or `opts.paletteVisible: true` to
`context.commands.register(id, handler, opts)` surfaces the command in the
app's Command Palette, namespaced as `${pluginId}.${id}` (so two plugins can
both register a command literally called `id` without colliding). The
palette entry shows `opts.title` if given, otherwise the raw `id`. Disposing
the returned `Disposable` (or unloading the plugin) removes the palette
entry along with the command registration.

```typescript
context.commands.register("summarize", () => summarize(), {
  title: "AI Summary: Summarize current document",
  paletteVisible: true,
});
```

## Tiptap Extension plugins

Plugins can provide custom Tiptap (ProseMirror) extensions. Declare them in
the manifest:

```json
{
  "tiptapExtensions": [
    {
      "type": "node",
      "name": "customBlock",
      "exportName": "CustomBlock"
    }
  ]
}
```

Then export the Tiptap extension from your entry point:

```javascript
import { Node } from "@tiptap/core";

export const CustomBlock = Node.create({
  name: "customBlock",
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: 'div[data-type="custom-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "custom-block" }, 0];
  },
});

export function activate(context) {
  // Additional plugin logic
}
```

**Important:** the ProseMirror schema is only built once, at app startup.
Plugins with `tiptapExtensions` require a **full app restart** to take
effect — reloading the plugin from the Developer section (see below)
re-runs `activate`/`deactivate` but does **not** rebuild the schema, so a
schema-contributing change will not show up until you restart the app.

## Local development loop

**Settings → Plugins → Developer** lets you iterate on a plugin without
packaging or installing it:

- **Load dev plugin folder** — opens a native folder picker
  (`@tauri-apps/plugin-dialog`); pick any directory containing a
  `baram-plugin.json` + built `main` bundle. The plugin is registered as a
  dev plugin and loaded immediately.
- **Reload** — re-reads the manifest from disk and reloads the plugin's
  module (unload the old instance, re-`import()` the bundle, re-run
  `activate`). Use this after rebuilding your bundle (`npm run build`) to
  pick up code changes without restarting the app. If the reloaded manifest
  declares `tiptapExtensions`, you'll see a toast reminding you a full
  restart is still required for schema changes (see above) — Reload alone
  never rebuilds the schema.
- **Remove** — unloads the plugin and forgets the dev folder (does not
  delete anything on disk).

Dev-loaded plugins **skip checksum verification** (there is no download URL
or checksum for a local folder) — this is a deliberate local-trust
shortcut, not a security check that was accidentally missed. See
[Trust model & security](#trust-model--security).

## Using the public types

Author against the generated public type declarations rather than Baram's
internal source:

- [`examples/plugins/plugin-api.d.ts`](../examples/plugins/plugin-api.d.ts) —
  generated from `src/plugins/public-api.ts` via `npm run types:plugin`
  (`tsc -p tsconfig.plugin-api.json`); re-exports every public interface
  (`ExtensionContext`, `AIAPI`, `NetworkAPI`, `StorageAPI`, `UIAPI`,
  `CommandsAPI`, `EditorAPI`, `EventsAPI`, `FilesAPI`,
  `PluginManifest`/`PluginCapability`/`PluginEventName`, and the option/model
  types) as type-only declarations.
- [`examples/plugins/types.d.ts`](../examples/plugins/types.d.ts) — a small
  sibling `.d.ts` the barrel depends on.

Copy both files next to your plugin's source (both example plugins'
`tsconfig.json` instead reference them via a relative `include` path — either
approach works) and import types from there:

```typescript
// sandboxed (the default tier)
import type { SandboxContext } from "./plugin-api";

// trusted
import type { ExtensionContext, StatusBarItem } from "./plugin-api";
```

This gives you full editor autocomplete and type-checking with **no
dependency on Baram's internal source tree** — `word-count/src/index.ts` and
`ai-summary/src/index.ts` both typecheck against the committed `.d.ts` files
alone (`npm run typecheck` in either example directory, or `tsc --noEmit`).

## Bundling

Use esbuild to produce a single ESM bundle. **What you may leave external depends on your
tier**, and getting it wrong fails at activate rather than at build time:

**Sandboxed — bundle everything, no `--external` at all:**

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
```

A sandboxed plugin is imported from a `blob:` URL, and a blob module has **no base URL**, so
any bare `import` left in the output cannot resolve. Mark something external and the plugin
loads to a resolution error. (This tier also cannot use Tiptap at all — extensions are
injected into the main realm's ProseMirror instance, which is exactly what it has no access
to.)

**Trusted — keep `@tiptap/core` and `@tiptap/pm` external**, since the host provides them at
runtime and bundling them in would duplicate — and likely desync — the app's own ProseMirror
instance:

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
  --external:@tiptap/core --external:@tiptap/pm
```

`package.json` script — `word-count` (sandboxed) and `ai-summary` (trusted) differ exactly
here, which is the difference worth copying carefully:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs"
  }
}
```

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm"
  }
}
```

## Publishing to the Registry

### The registry JSON shape

The marketplace fetches a single JSON document — a `RegistryIndex` — and
deserializes it on the Rust side (`fetch_registry`), entry by entry:

```typescript
interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  downloadUrl: string; // URL of a hosted plugin ZIP
  checksum: string; // SHA-256 of that ZIP, hex-encoded
  capabilities: PluginCapability[];
  trust: "sandboxed" | "trusted"; // required — see below
  engines: { baram: string };
  icon?: string;
  keywords?: string[];
  downloads?: number;
  repository?: string;
  homepage?: string;
}
```

All keys are camelCase on the wire (matching `baram-plugin.json` and the TS
types in `src/plugins/types.ts`). `downloadUrl` must point at a hosted ZIP
containing the plugin (same contents as the packaging step below); `checksum`
is that ZIP's SHA-256, hex-encoded. Registry installs verify `checksum`
before extracting the ZIP — the host refuses to install a package whose hash
doesn't match.

#### Archive limits

The download and the extraction are bounded separately, because a small archive
can expand to an enormous one:

| Limit | Value |
| --- | --- |
| Compression method | `Stored` or `Deflated` only |
| Archive size on the wire | 32 MiB |
| Files in the archive | 2,000 |
| Path components in any entry | 16 (`dist/chunks/x.mjs` is 3) |
| Any single file, expanded | 64 MiB |
| All files together, expanded | 256 MiB |
| Expanded ÷ compressed ratio | 100:1, or 1 MiB, whichever is larger |

These are set far above anything a real plugin needs — the published reference
plugin expands to tens of kilobytes, and `dist/chunks/index.mjs` is depth 3 —
and exist to stop a hostile archive from exhausting memory or disk. If you have
a legitimate reason to exceed one (a bundled dictionary, a font, a WASM module),
open an issue; the ratio limit in particular is deliberately loose enough for
ordinary compressible assets, and the 1 MiB allowance means small archives are
never judged on a ratio computed from too little output.

Extraction stops at the first limit reached, **while unpacking** rather than
afterwards, so an archive that would exceed one never gets to write the excess.

Every byte limit is enforced on bytes actually read, not on the sizes the
archive declares in its own headers, so a mis-stated size will not get you past
them. The compression allowlist is separate and stricter for a reason: LZMA and
PPMd size their internal buffers from the archive *before* producing a single
byte, so no read limit can bound them — `zip -r`, which is what the release
pipeline runs, produces `Deflated`.

#### A malformed entry costs only itself

Every field above without a `?` is required **of you**, but Baram does not fail
the whole document when one is missing. An entry it cannot read is dropped and
the rest of the index is served, so one contributor's typo cannot empty the
marketplace for everyone. `engines` is looser still: it may be absent on the
wire, because a missing floor already means "no opinion" to the version gate,
and deleting an installable plugin over it would be the worse answer.

That tolerance is the reader being liberal, not the requirements going soft —
and it is silent, which is the trade. A dropped entry looks exactly like an
entry nobody published. The signal lives at publish time instead:
`scripts/validate-index.ts` reads the index with the app's own parsers and
refuses anything the app would quietly prune, demote, or stop protecting. It
runs in `npm run lint:frontend`, in `plugin-release.yml`, and on every pull
request to `sayinel/baram-plugins` itself, against the entire index rather than
only the entry being added.

It judges the *document*, though — it has never opened an archive, because in
this repository there are none. `scripts/validate-registry-assets.ts` is the
other half: given a checkout of the registry, it resolves each entry's
`downloadUrl` the way GitHub Pages will, requires a regular file to be there,
and hashes it against the declared checksum. An entry naming a missing file, or
carrying a stale checksum, otherwise deploys cleanly and 404s or fails
integrity for every user.

Run both before proposing a registry change:

```bash
npx tsx scripts/validate-index.ts path/to/index.json
npx tsx scripts/validate-registry-assets.ts path/to/registry-checkout
```

#### `trust` and `capabilities` are a claim the install verifies

`trust` is **required**. An entry without it is shown with a "Legacy" badge and its
Install button is disabled: the manifest inside the ZIP must declare a tier, so
offering the install would only download first and fail second.

`trust` and `capabilities` here are what the user is asked to approve **before** the
download — the consent dialog is built from the registry entry, because that is all the
app knows at that point. After the ZIP is fetched, the manifest inside it is checked
against what was approved, and the install is rolled back if it asks for more:

- a manifest declaring `trust: "trusted"` where the entry said `"sandboxed"`
- a manifest requesting a capability the entry did not list
- a manifest whose `id` differs from the entry's

Nothing is written to the plugin store until all three pass, so a registry that
advertises one thing and ships another fails the install rather than escalating it.
Listing _fewer_ capabilities in the manifest than in the entry is fine — the check is
"does not exceed", not "matches exactly" — and `files` covers `files:readonly`, as does
`editor` for `editor:readonly`.

Keep the entry in step with the manifest you ship. A mismatch is not a warning.

### How Baram loads the registry

The marketplace (`PluginMarketplace.tsx`, via `fetchRegistryIndex()` in
`src/plugins/registry-client.ts`) fetches whatever URL is stored in
`registryUrl` — a persisted field of the plugin Zustand store
(`src/stores/system/plugin.ts`), read by the Rust `fetch_registry` command.
There is currently **no settings-screen field to edit it** — it is a plain
persisted store value defaulting to `DEFAULT_REGISTRY_URL`:

```
https://sayinel.github.io/baram-plugins/index.json
```

The registry lives at
[`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins) — a
public repo served via GitHub Pages that hosts `index.json` plus the plugin
ZIPs under `plugins/`. It accepts **first-party plugins only** for now;
community submissions are a future consideration.

Publishing is driven from this repo's CI: pushing a tag
`plugin-<dir>-v<version>` (e.g. `plugin-word-count-v1.0.0`, where `<dir>` is
the directory under `examples/plugins/` and the version must match that
plugin's `baram-plugin.json`) runs `.github/workflows/plugin-release.yml`,
which builds the plugin, packages the ZIP per the contract above, computes
its SHA-256, and pushes the ZIP plus an updated `index.json` to the registry
repo.

Two refusals happen before anything is built: a manifest without a valid
`trust` fails the release outright (an entry without a tier can only describe
a plugin nobody can install), and the directories `malicious-fixture` and
`sandbox-smoke` are denied by name, so a mistyped tag cannot publish a test
fixture to the public registry.

### Local testing

To exercise the marketplace UI without a live registry, point `registryUrl`
at the repo's own committed seed instead of the default:
[`registry/index.json`](../registry/index.json). There is no settings-screen
field for this yet, but `registryUrl` is a Zustand-`persist`ed value stored
under the `"baram:plugins"` key in this app's config file (Tauri
`app_data_dir/config.json`, keyed by the app identifier `com.inel.baram` —
on macOS that's
`~/Library/Application Support/com.inel.baram/config.json`). The value at
that key is itself a JSON string of the shape
`{"state":{...,"registryUrl":"..."},"version":1}`. With the app closed, edit
the nested `state.registryUrl` field to a local URL, then relaunch:

- **Local static server** (recommended) — serve `registry/` with any static
  file server, e.g. `npx serve registry` or
  `python3 -m http.server --directory registry 8000`, and set `registryUrl`
  to `http://localhost:8000/index.json`.
- **File path** — some platforms accept a `file://` path directly at your
  local checkout's `registry/index.json`; a local static server is more
  portable since Tauri's webview may restrict `file://` fetches.

Once `registryUrl` points at the local seed, open **Settings → Plugins**
(the "Browse" tab) — it calls `fetchRegistryIndex()` on mount. Note the
registry response is cached for 24 hours; the **Browse** and **Updates** tabs
show an always-available **↻ Refresh** button that bypasses the cache
(`fetchRegistryIndex(true)`) and re-runs the update check
(`checkForUpdates()`) against the fresh index, so you don't need to restart
the app to pick up a new `registry/index.json`. The **Retry** button shown
when the fetch errored does the same thing. The cache lives in memory only,
so restarting the app also forces a fresh fetch if needed.
`registry/index.json` is the canonical
example of a valid `RegistryIndex`: it lists `baram-word-count` with every
required field — including `trust` — populated from its real manifest. Note that
**installing** from it is not possible until 2.0.0 is published; see below.

### The committed seed

The seed exists so the repo has an offline, schema-correct `RegistryIndex`
fixture. A Rust drift-guard test (`test_committed_registry_seed_deserializes`)
deserializes it on every test run and fails if its shape stops looking like the
live registry — including a missing `trust`, since an entry without one
describes a plugin the app refuses to install.

**Installing from the seed does not work right now, and not because of the
seed.** §260's tier model requires every manifest to declare `trust`, and every
ZIP published before it — `baram-word-count` 1.0.0/1.0.1, `baram-ai-summary`
1.0.0 — has a manifest that predates the field, so `validateManifest` rejects
the download whatever the index says about it. The seed therefore names the
**next** release (`baram-word-count` 2.0.0) with a `checksum` of **64 zeros**,
and an install attempt fails on the missing ZIP. Until that release ships, use
the seed to exercise the marketplace **UI** — listing, capability and tier
badges, the legacy state, refresh — and dev-load from source
(**Settings → Plugins → Developer**) to exercise a plugin actually running.

Two further things the seed is **not**:

- It is not a byte-for-byte copy of the live index. It is Prettier-formatted
  (the live file is written by `update-registry-index.mjs`), and it holds only
  entries worth publishing — `baram-ai-summary` is absent because it is not
  published.
- The placeholder checksum is **not** filled in automatically. The release
  workflow clones `sayinel/baram-plugins` and updates only _that_ repo's
  `index.json`; nothing writes back here. After publishing a version, a
  maintainer copies the workflow's `sha256sum` output into this file by hand.
  Forgetting is now **reported but not blocked**: `validate-index.ts` warns on
  an all-zero checksum on every `npm run lint`, while still allowing a seed to
  name a release whose ZIP does not exist yet. The 64-hex shape check on its
  own could never see it, since zeros satisfy it.

### Publishing your own plugin

1. Create a GitHub repository for your plugin.
2. Build your plugin: `npm run build`.
3. Create a ZIP containing `baram-plugin.json`, your built `main` bundle
   (e.g. `dist/index.mjs`), and `assets/` (if any).
4. Create a GitHub Release with the ZIP as an asset, and compute its SHA-256
   checksum (e.g. `shasum -a 256 your-plugin-1.0.0.zip`).
5. Add a `RegistryEntry` to whichever `RegistryIndex` you're publishing to —
   typically your own self-hosted `index.json`. (First-party plugins in this
   repo don't do this by hand: pushing a `plugin-<dir>-v<version>` tag drives
   [`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins)'
   `index.json` automatically, as described above.)

```json
{
  "id": "my-word-count",
  "name": "Word Count",
  "description": "Displays word and character count",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "downloadUrl": "https://github.com/user/my-word-count/releases/download/v1.0.0/my-word-count-1.0.0.zip",
  "checksum": "sha256-hash-of-zip",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "trust": "sandboxed",
  "keywords": ["word", "count"],
  "engines": { "baram": ">=0.5.0" }
}
```

## Trust model & security

Read this before installing a plugin you didn't write, and before writing a
plugin others will install. **Capabilities are install-time-approved intent
declarations plus API gating — they are not a hard sandbox.** Only the
Shadow-DOM boundary (see above) provides real isolation, and it isolates CSS
only, not JavaScript. Plugins execute in the same JS context as the editor;
a plugin with `editor` or `files` capability can, in principle, do anything
that capability's API surface allows, and a malicious or buggy plugin can
still misbehave within its granted APIs.

**`network` is unrestricted egress by design.** `context.network.fetch()`
can reach loopback addresses, private/RFC1918 IP ranges, and cloud
instance-metadata endpoints — none of these are blocked. This is a
deliberate choice (not an oversight): it's what makes talking to a local
Ollama server or a local dev server useful from a plugin. Concretely:

- Only `http://` and `https://` URL schemes are allowed; anything else is
  rejected before the request is made.
- The response body is always decoded as a UTF-8 string — **there is no
  binary/bytes mode**; fetching a binary resource will silently corrupt it.
- Duplicate response headers collapse to a **last-wins** single value (no
  multi-value header support).
- Every request has a **30-second timeout** and a **10 MiB** response-size
  cap (streamed and enforced incrementally, so an unbounded response is
  rejected once it crosses the cap rather than after buffering the whole
  thing).

**`storage` is app-global, not per-vault**, and stored in plaintext at
`~/.baram/plugin-data/<pluginId>/<key>` on disk — a plugin's storage is
shared across every vault you open, not scoped to "the current vault". Keys
are constrained to a single safe path segment (no `/`, no `..`) so a key
can't escape the plugin's own storage directory, but this is **not
symlink-hardened**: it's purely a filename-shape check, not a
canonicalize-and-verify-real-path check.

**`ai` consumes the user's own configured provider, model, and API
key/quota** — a plugin cannot bring its own key, and every `complete`/
`stream` call is billed against whatever the user has configured in
Settings → AI. **Privacy mode only gates `complete` and `stream`** — when
privacy mode (or a per-file `privacy: true` frontmatter flag) is active,
those two calls reject unless the configured provider is a local one
(currently only Ollama). **`listModels()` is not gated by privacy mode** and
may still call out to a cloud provider's API to enumerate models even while
privacy mode is otherwise blocking `complete`/`stream` — don't assume
calling `listModels()` is privacy-safe just because privacy mode is on.

**Checksums are registry-only.** Plugins installed from the registry are
verified against a SHA-256 checksum before install; **dev-folder loads
(the Developer section) skip this entirely** — loading a local folder is an
explicit, deliberate act of trusting that code, with no cryptographic check
in between. Dev-folder loading is also **development-builds only**: it bypasses
the checksum, the registry listing and the consent record all at once, so a
packaged build refuses it.

**Installing records what you approved.** The install dialog lists the requested
capabilities and, for `trust: "trusted"`, states plainly that the capability list does
_not_ bound the plugin — a trusted plugin runs inside Baram itself and holds everything
regardless of what it declared, so that one needs an explicit acknowledgement. The
approved `(trust, capabilities)` is stored with the plugin, and an **update that exceeds
it asks again**: a plugin installed as `sandboxed` cannot quietly become `trusted`, and
a new capability is shown as new. An update that asks for _less_ installs without a
prompt and narrows the record.

**Sandboxes share an origin with the app and with each other.** Tauri v2 has no
per-window origin, so a `plugin-*` webview cannot be given its own. Three consequences,
all of them bounds rather than bugs:

- The app keeps nothing in `localStorage` — everything persists through Rust's config
  file — precisely because a plugin could otherwise read it with no capabilities at all.
- Two installed plugins can still reach each other through `BroadcastChannel`, so a
  plugin without `network` could use a `network`-granted plugin as a proxy if both are
  malicious. Capability grants bound one plugin, not a pair that cooperate.
  `SharedWorker` was the same kind of channel and is blocked — the sandbox denies
  `worker-src` outright, which also means **no `Worker` at all in a sandboxed plugin**.
- `indexedDB` and the Cache API are reachable without the `storage` capability. They give
  a plugin persistence that the capability system does not gate; they do not give it
  anything of the app's, because the app stores nothing in either. Prefer `ctx.storage`:
  it is the only plugin storage the user can see and that uninstalling actually removes.

**Bottom line: only install plugins you trust**, especially any declaring
`ai`, `network`, `files`, or `storage`. New capabilities added in a plugin
update require re-approval before the update takes effect.

## Timeouts & error handling

- `activate()`: 5 second timeout.
- `deactivate()` and other lifecycle hooks: 1 second timeout.
- If a plugin times out, it is marked as errored and can be manually
  re-enabled.
- Plugin errors never crash the main app.
- React components rendered from plugin UI are wrapped in Error Boundaries.
- Failed plugins are marked with an error state in the marketplace/dev UI.
- Check the browser console for detailed plugin error logs.
