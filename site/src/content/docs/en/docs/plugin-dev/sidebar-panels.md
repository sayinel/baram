---
title: "Sidebar panels"
---

## `context.ui.setPanel` (requires `sidebar`, sandboxed)

A sandboxed plugin can have up to three panels of its own in the sidebar. Each gets a button on the
activity bar, and its panel fills the sidebar under a header Baram draws: the panel's title and
`Plugin · ` with your plugin's name. You send the panel's content as strings — the same HTML and CSS
a [code block renderer](/en/docs/plugin-dev/code-blocks/) returns — and Baram sanitizes them and
draws them in a shadow root of their own.

A trusted plugin mounts its own DOM in a panel instead, with `ctx.ui.addSidebarPanel` — see
[Context: UI and Shadow-DOM isolation](/en/docs/plugin-dev/context-ui-and-shadow-dom/).

```typescript
setPanel(id: string, content: RenderedContent): void;
onPanelAction(id: string, handler: (action: string) => Promise<void> | void): Disposable;

// RenderedContent = { html: string; css?: string }
```

## Declaring panels

Declare every panel in the manifest, with the `sidebar` capability:

```json
{
  "trust": "sandboxed",
  "capabilities": ["sidebar", "files:readonly"],
  "contributions": {
    "panels": [{ "id": "recent", "title": "Recent notes", "icon": "🕘" }]
  }
}
```

- At most 3 panels. An `id` is letters, digits, `_` and `-`, at most 64 characters, each id once. A
  `title` is text that is not empty; Baram sanitizes it and shortens it to 64 characters, and shows the panel's `id` if nothing is left. An `icon`, if you give one, is a single character — an
  emoji or a letter — of at most 16 UTF-16 units. Without an icon, or with one that draws nothing (for
  example a space, a line break, a zero-width joiner, a variation selector on its own, a Hangul filler), the
  button shows a generic plugin icon.
- `panels` without the `sidebar` capability is a manifest error, and so is `panels` in a trusted
  manifest.
- The buttons appear before your plugin's code runs, so they show while it starts. A button's label
  is the panel's title followed by `Plugin · ` and your plugin's name, so a panel cannot pass for one
  of Baram's own.
- A user may install the plugin without granting `sidebar`. The plugin still loads, but Baram refuses
  each `setPanel` — it does not throw, and your plugin gets no error.

## Sending content

```typescript
const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function activate(ctx: SandboxContext) {
  const draw = async () => {
    const names = (await ctx.files.listDir("")).filter((n) => n.endsWith(".md"));
    ctx.ui.setPanel("recent", {
      html: `<ul>${names
        .map((n) => `<li><a data-note="${escape(n)}">${escape(n)}</a></li>`)
        .join("")}</ul>`,
      css: "ul { margin: 0; padding: 0 12px; }",
    });
  };
  void draw();
  ctx.events.on("vault:changed", () => void draw());
}
```

- `setPanel` throws at once for an id you did not declare, and for content over a limit — more than
  1 MiB of HTML or 64 KiB of CSS in UTF-8, or a lone surrogate (half an emoji) — with the sentences a
  renderer's result meets.
- Baram keeps the last content of each panel. A panel that is not on screen is not drawn; when the
  user opens it, Baram draws the last content it received.
- Call `setPanel` as often as you like: the latest content wins, and Baram draws a panel that is on
  screen at most once every 250 milliseconds. A call made while the previous one is still on its way
  replaces the content waiting to go, so the last content always arrives.
- Until your first `setPanel`, the panel says it has nothing to show yet.

## What may come back

Baram sanitizes a panel's content as it does a code block renderer's result — see
[What may come back](/en/docs/plugin-dev/code-blocks/#what-may-come-back) for what is removed or
refused, and the limits. Two things differ:

- A panel scrolls inside the sidebar, vertically, with no height limit of its own. It does not
  scroll sideways — what is wider than the sidebar is cut off — so put wide content in an element of
  your own with `overflow-x: auto`.
- Refused CSS, or content over the node limit, shows `Render failed — ` and the reason under the
  panel's header, and the last drawing stays, faded.

## Clicks

Clicks are judged as in a code block — see [Clicks](/en/docs/plugin-dev/code-blocks/#clicks) — with
these differences:

- `data-note="notes/a.md"` is relative to the root of the vault or folder that is active **when the
  user clicks**: a panel belongs to no note. With no vault or folder active, or if the path is not a
  note there, nothing opens and Baram says so. `data-note` and `listDir("")` both use whichever
  context is active at that moment. To keep a list current, redraw on `vault:changed` (needs `files`
  or `files:readonly`) or on `file:open` (needs `events`); both carry the `context` they refer to.
- `data-action="name"` calls the handlers you registered for that panel with
  `onPanelAction(id, handler)`; each gets the name. Until every one has settled,
  [`ctx.prompts`](/en/docs/plugin-dev/context-prompts/) may open, for the 30 seconds a command runs
  on — counted from the click, and again from each prompt closing. `onPanelAction` throws for an id
  you did not declare.
- A right click does none of these.

Showing a panel, or drawing it, grants nothing: only a click on a `data-action` element lets your
plugin open a prompt.

The Baram repository has no example plugin with a panel; `examples/plugins/backlinks-block` draws
the same kind of content in a code block.

## Version floor

`ctx.ui.setPanel`, `ctx.ui.onPanelAction` and `contributions.panels` are new. Set `engines.baram` to
the first release whose notes list them — see
[Version floor](/en/docs/plugin-dev/manifest/#version-floor).
