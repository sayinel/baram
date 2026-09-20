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
| Thread colour | the app's accent colour | Pick one of the eight theme colours, or type any CSS colour — a hex value, `rgb(…)`, a colour name, or one of Baram's own tokens such as `var(--color-text-muted)`. A theme colour follows dark mode; a hex value does not |
| Line width (px) | `2` | How thick the line is, between 0.5 and 8 |
| Branch into each item | on | Off leaves only the vertical rails, with no line turning in towards each item |
| Marker at the caret | filled with a halo | How the item you are in is picked out — filled with a halo, filled, or left the same as the rest of the thread |
| Only while editing | off | Hides the thread whenever the editor does not have focus, so it goes quiet while you read a side panel |

Changes take effect **immediately** — there is nothing to toggle and nothing to restart.

If a colour you typed is not valid CSS, the plugin falls back to the accent colour rather
than producing a broken stylesheet.

## Turning it off

**Settings → Plugins → Bullet Threading → Enabled.** Turning it off removes the line
immediately and leaves nothing behind. **Uninstall** removes the plugin's files as well.

## Requirements

Baram 0.7.4 or newer. (Version 2.0.1 runs on 0.7.0, without the settings above applying
live.)

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
