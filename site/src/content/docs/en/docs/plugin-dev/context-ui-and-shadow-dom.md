---
title: "Context: UI and Shadow-DOM isolation"
---

## `context.ui`

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
  `var(--color-border-default)`, `var(--color-bg-subtle)`, etc.) are
  still visible inside your shadow root, so you can theme your panel against
  the live app theme without duplicating token values. See
  `examples/plugins/ai-summary/src/index.ts` for a full example that themes
  entirely off inherited custom properties.
- `onMount(el)` receives the shadow root's inner content `<div>`, not the
  `ShadowRoot` object itself (a `ShadowRoot` has no `.style`/`.classList`).
  `onUnmount(el)`, if provided, is called before the host removes the
  subtree — use it for teardown that isn't a tracked `Disposable` (timers,
  manual event listeners you added directly to `el`'s descendants, etc).
