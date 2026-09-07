---
title: "Entry point and public types"
---

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

## Using the public types

Author against the generated public type declarations rather than Baram's
internal source:

- [`examples/plugins/plugin-api.d.ts`](https://github.com/sayinel/baram/blob/main/examples/plugins/plugin-api.d.ts) —
  generated from `src/plugins/public-api.ts` via `npm run types:plugin`
  (`tsc -p tsconfig.plugin-api.json`); re-exports every public interface
  (`ExtensionContext`, `AIAPI`, `NetworkAPI`, `StorageAPI`, `UIAPI`,
  `CommandsAPI`, `EditorAPI`, `EventsAPI`, `FilesAPI`,
  `PluginManifest`/`PluginCapability`/`PluginEventName`, and the option/model
  types) as type-only declarations.
- [`examples/plugins/types.d.ts`](https://github.com/sayinel/baram/blob/main/examples/plugins/types.d.ts) — a small
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
