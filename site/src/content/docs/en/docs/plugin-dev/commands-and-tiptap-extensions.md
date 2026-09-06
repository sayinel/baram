---
title: "Command palette and Tiptap extensions"
---

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
