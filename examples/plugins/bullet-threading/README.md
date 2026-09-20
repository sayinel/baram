# Bullet Threading

Shows you where you are in a nested list. Put the caret in a list item and Baram draws a
line from the outermost ancestor down to that item, so the path you are inside is visible
at a glance — the way [Logseq's bullet threading][logseq] does.

[logseq]: https://github.com/pengx17/logseq-plugin-bullet-threading

It works on bullet lists, numbered lists and task lists, and it draws nothing at all when
the caret is outside a list.

- **Bullets** get the thread attached to the bullet itself, and the item holding the
  caret gets a filled dot with a soft halo.
- **Numbers** get the thread set slightly apart from the digits, and the item holding the
  caret has its number in bold with the same halo — no box around it.

Nothing is written to your document. The line is drawn by the editor as you move the
caret, so your Markdown file is untouched and the feature leaves no trace in it.

## Settings

**Settings → Plugins → Bullet Threading**

| Setting | Default | What it does |
| --- | --- | --- |
| Thread colour | the app's accent colour | Any CSS colour — a hex value, `rgb(…)`, a colour name, or one of Baram's own theme tokens such as `var(--color-text-muted)` |
| Line width (px) | `2` | How thick the line is. Values outside 0.5–8 fall back to the default |
| Curve into each item | on | Rounds the line into each item instead of dropping straight down |

‼️ **A change takes effect the next time the plugin loads, not immediately.** Toggle the
plugin off and on under **Settings → Plugins** — or restart Baram — to see it. This is a
limit of the plugin API rather than a choice: there is no event that tells a plugin its
settings changed, so the stylesheet this plugin builds when it starts cannot be rebuilt
when you edit a value.

If a colour you typed is not valid CSS, the plugin falls back to the accent colour rather
than producing a broken stylesheet.

## Turning it off

**Settings → Plugins → Bullet Threading → Enabled.** Turning it off removes the line
immediately and leaves nothing behind. **Uninstall** removes the plugin's files as well.

## Requirements

Baram 0.7.0 or newer.

This is a **fully trusted** plugin, so installing it asks you to acknowledge that. That
is not a judgement about this plugin — it is what any plugin that draws inside the editor
has to be, because the editor's rendering runs in the app itself and there is no
sandboxed way to reach it. It is published by the Baram project, and its full source is in
the Baram repository under `examples/plugins/bullet-threading/`.

## For plugin authors

This is also Baram's reference example for contributing a ProseMirror plugin to the live
editor. If you are writing one, read
[`IMPLEMENTATION.md`](https://github.com/sayinel/baram/blob/main/examples/plugins/bullet-threading/IMPLEMENTATION.md)
in that directory and the
[plugin development guide](https://baram.ing/en/docs/plugin-dev/commands-and-tiptap-extensions/).
