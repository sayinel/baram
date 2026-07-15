# Baram Plugin Development Guide

## Overview

A Baram plugin is a directory containing a manifest (`baram-plugin.json`) and
a single ESM bundle (typically `dist/index.mjs`). The bundle exports an
`activate(context)` function (and optionally `deactivate()`); the host calls
`activate` with a capability-gated `ExtensionContext` object that is the
plugin's only way to touch the app.

Plugins run **in the same JavaScript context as the editor** — there is no
iframe or worker sandbox (Obsidian's model, not Logseq's). This was a
deliberate design decision: contributing a `tiptapExtensions` node/mark/plugin
requires direct access to the live ProseMirror `Schema`, which an
iframe-sandboxed plugin cannot provide. The tradeoff is that the capability
system is an **API gate**, not a hard security boundary — see
[Trust model & security](#trust-model--security) below before installing or
authoring anything sensitive.

## Quick Start

The fastest way to start a new plugin is to copy one of the two reference
examples in [`examples/plugins/`](../examples/plugins/):

- [`examples/plugins/word-count/`](../examples/plugins/word-count/) — minimal:
  a status-bar item with an `editor:readonly` + `events` + `statusbar` plugin.
- [`examples/plugins/ai-summary/`](../examples/plugins/ai-summary/) —
  advanced: Shadow-DOM sidebar panel + settings tab, `ai` + `storage`
  capabilities.

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
  "id": "baram-word-count",
  "name": "Word Count",
  "description": "Displays word and character count in the status bar",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "dist/index.mjs",
  "engines": {
    "baram": ">=0.3.0"
  },
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "keywords": ["word", "count", "statistics"],
  "repository": "https://github.com/user/baram-word-count",
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
| `engines.baram` | string    | Minimum Baram version (semver range)                                       |
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
| `settings`        | Add options to the settings screen      |               |
| `ai`              | Access AI/LLM features                  | **sensitive** |
| `network`         | Make network requests                   | **sensitive** |
| `storage`         | Use a plugin-private key/value store    | sensitive     |

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
```

`context.ui` itself is available whenever the manifest declares `sidebar`,
`statusbar`, or `settings` (any one of the three unlocks the object), but
each method has its own per-method gate:

| Method              | Requires capability                         |
| ------------------- | ------------------------------------------- |
| `showStatusBarItem` | `statusbar`                                 |
| `addSidebarPanel`   | `sidebar`                                   |
| `addSettingsTab`    | `settings`                                  |
| `showNotification`  | any of `sidebar` / `statusbar` / `settings` |
| `addStyle`          | any of `sidebar` / `statusbar` / `settings` |

Notes:

- `showStatusBarItem` returns a `StatusBarItem` object — call `.setText(...)`
  to update the text in place, `.dispose()` to remove it. Its second
  parameter is `align: "left" | "right"` and defaults to `"right"`.
- `addStyle(css)` injects a `<style>` tag into `document.head` (light DOM).
  It **cannot** style content inside a Shadow-DOM sidebar panel or settings
  tab — see [Shadow-DOM UI isolation](#shadow-dom-ui-isolation).
- `addSidebarPanel` / `addSettingsTab` both mount into an isolated Shadow-DOM
  subtree via `onMount(el)` — see the next section.

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
import type { ExtensionContext, StatusBarItem } from "./plugin-api";
```

This gives you full editor autocomplete and type-checking with **no
dependency on Baram's internal source tree** — `word-count/src/index.ts` and
`ai-summary/src/index.ts` both typecheck against the committed `.d.ts` files
alone (`npm run typecheck` in either example directory, or `tsc --noEmit`).

## Bundling

Use esbuild to produce a single ESM bundle, keeping `@tiptap/core` and
`@tiptap/pm` external (the host provides these at runtime; bundling them in
would duplicate — and likely desync — the app's own ProseMirror instance):

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
  --external:@tiptap/core --external:@tiptap/pm
```

`package.json` script (as used by both examples):

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm"
  }
}
```

## Publishing to the Registry

> The community registry repository (`baram-community/plugin-registry`) is
> not live yet — this section describes the intended flow (Phase F) so
> plugin authors can prepare ahead of time; treat it as forward-looking, not
> a working URL today.

1. Create a GitHub repository for your plugin.
2. Build your plugin: `npm run build`.
3. Create a ZIP containing `baram-plugin.json`, your built `main` bundle
   (e.g. `dist/index.mjs`), and `assets/` (if any).
4. Create a GitHub Release with the ZIP as an asset.
5. Submit a PR to `baram-community/plugin-registry` adding a `RegistryEntry`
   to its index:

```json
{
  "id": "baram-word-count",
  "name": "Word Count",
  "description": "Displays word and character count",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "downloadUrl": "https://github.com/user/baram-word-count/releases/download/v1.0.0/baram-word-count-1.0.0.zip",
  "checksum": "sha256-hash-of-zip",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "keywords": ["word", "count"],
  "engines": { "baram": ">=0.3.0" }
}
```

Registry installs verify `checksum` (SHA-256) before extracting the ZIP; the
host refuses to install a package whose hash doesn't match.

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
in between.

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
