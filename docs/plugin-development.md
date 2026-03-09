# Baram Plugin Development Guide

## Plugin Format

A Baram plugin is a directory with the following structure:

```
my-plugin/
  baram-plugin.json    # Manifest (required)
  index.mjs            # Entry point — single ESM bundle (required)
  assets/              # Static resources (optional)
```

## Manifest (`baram-plugin.json`)

```json
{
  "id": "baram-word-count",
  "name": "Word Count",
  "description": "Displays word and character count in the status bar",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.mjs",
  "engines": {
    "baram": ">=0.2.0"
  },
  "capabilities": ["editor:readonly", "statusbar"],
  "keywords": ["word", "count", "statistics"],
  "repository": "https://github.com/user/baram-word-count",
  "homepage": "https://example.com"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier. Lowercase letters, digits, hyphens only. |
| `name` | string | Human-readable display name |
| `description` | string | Short description |
| `version` | string | Semver version |
| `author` | string | Author name |
| `license` | string | SPDX license identifier |
| `main` | string | Entry point file (relative to plugin directory) |
| `engines.baram` | string | Minimum Baram version (semver range) |
| `capabilities` | string[] | Required permissions (see below) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `dependencies` | string[] | Other plugin IDs this plugin depends on |
| `tiptapExtensions` | object[] | Tiptap extensions exported by this plugin |
| `repository` | string | Source code URL |
| `homepage` | string | Documentation URL |
| `icon` | string | Emoji icon for the marketplace |
| `keywords` | string[] | Search keywords |

## Capabilities

Plugins must declare required capabilities in the manifest. Users are prompted to approve these during installation.

| Capability | Description |
|------------|-------------|
| `editor` | Read and modify document content |
| `editor:readonly` | Read document content (no modification) |
| `files` | Read and write files in the vault |
| `files:readonly` | Read files in the vault (no writing) |
| `commands` | Register and execute editor commands |
| `sidebar` | Add panels to the sidebar |
| `statusbar` | Display items in the status bar |
| `settings` | Add options to the settings screen |
| `events` | Listen to editor events |
| `ai` | Access AI/LLM features |
| `network` | Make network requests |

Accessing an API without declaring its capability throws an error with a clear message.

## Entry Point (`index.mjs`)

The entry point must be a single ESM bundle. Export `activate` and optionally `deactivate`:

```javascript
export function activate(context) {
  // Called when the plugin is loaded
  // context provides capability-gated APIs

  // Register a command
  context.commands.register("sayHello", () => {
    context.ui.showNotification("Hello from my plugin!");
  });

  // Listen to events
  context.events.on("file:save", (filePath) => {
    console.log("File saved:", filePath);
  });
}

export function deactivate() {
  // Called when the plugin is unloaded
  // Clean up resources here
}
```

## ExtensionContext API

The `context` object passed to `activate()` provides these APIs (gated by declared capabilities):

### `context.commands` (requires `commands`)
```typescript
register(id: string, handler: Function): Disposable
execute(id: string, ...args: any[]): Promise<any>
```

### `context.editor` (requires `editor` or `editor:readonly`)
```typescript
getContent(): string
setContent(content: string): void       // editor only
getSelection(): { from, to, text }
insertText(text: string): void           // editor only
```

### `context.files` (requires `files` or `files:readonly`)
```typescript
readFile(path: string): Promise<string>
writeFile(path: string, content: string): Promise<void>  // files only
listDir(path: string): Promise<string[]>
```

### `context.events` (requires `events`)
```typescript
on(event: string, handler: Function): Disposable
emit(event: string, ...args: any[]): void
```

Available events: `file:open`, `file:save`, `editor:ready`

### `context.ui` (requires `sidebar` or `statusbar`)
```typescript
showNotification(message: string, type?: "info" | "warning" | "error"): void
showStatusBarItem(text: string, alignment?: "left" | "right"): Disposable
```

### `context.subscriptions`
Array of `Disposable` objects. All subscriptions are automatically disposed when the plugin is deactivated.

## Tiptap Extension Plugins

Plugins can provide custom Tiptap (ProseMirror) extensions. Declare them in the manifest:

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

**Important:** Plugins with Tiptap extensions require an app restart to take effect (ProseMirror schema must be rebuilt).

## Bundling

Use esbuild to create a single ESM bundle:

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
  --external:@tiptap/core --external:@tiptap/pm
```

### `package.json` scripts

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm"
  }
}
```

## Publishing to the Registry

1. Create a GitHub repository for your plugin
2. Build your plugin: `npm run build`
3. Create a ZIP containing `baram-plugin.json`, `index.mjs`, and `assets/` (if any)
4. Create a GitHub Release with the ZIP as an asset
5. Submit a PR to `baram-community/plugin-registry` adding your plugin to `index.json`:

```json
{
  "id": "baram-word-count",
  "name": "Word Count",
  "description": "Displays word and character count",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "download_url": "https://github.com/user/baram-word-count/releases/download/v1.0.0/baram-word-count-1.0.0.zip",
  "checksum": "sha256-hash-of-zip",
  "capabilities": ["editor:readonly", "statusbar"],
  "keywords": ["word", "count"],
  "engines": { "baram": ">=0.2.0" }
}
```

## Security Notes

- Plugins run in the same JavaScript context as the editor (no iframe sandbox)
- The capability system limits API access but cannot prevent all side effects
- Plugin code is executed via `import()` — only install plugins you trust
- Checksums (SHA-256) are verified during installation to prevent tampering
- New capabilities added in updates require re-approval from the user

## Timeouts

- `activate()`: 5 second timeout
- `deactivate()` and lifecycle hooks: 1 second timeout
- If a plugin times out, it is marked as errored and can be manually re-enabled

## Error Handling

- Plugin errors never crash the main app
- React components from plugins are wrapped in Error Boundaries
- Failed plugins are marked with an error state in the marketplace UI
- Check the browser console for detailed plugin error logs
