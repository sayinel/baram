---
title: "File tree decorations"
---

## `context.ui` and the file tree (requires `filetree`)

```typescript
setFileDecorations(updates: FileDecorationUpdate[]): Promise<void>;        // trusted
setFileDecorations(updates: SandboxFileDecorationUpdate[]): Promise<void>; // sandboxed
clearFileDecorations(): Promise<void>;
defineFileIcon(name: string, svg: string): Promise<void>;

// FileDecoration = { badge?: string; color?: FileDecorationPaletteColor | `#${string}`;
//   icon?: { glyph: string } | { svg: string }; tooltip?: string }
// FileDecorationUpdate        = { path: string; decoration: FileDecoration | null }
// SandboxFileDecorationUpdate = { path: string; context?: string; decoration: FileDecoration | null }
```

A plugin with `filetree` can put an icon, a badge, a color and a tooltip on rows of the file tree, in
both tiers. You push decorations; Baram keeps them per path and draws them while the row is shown.
`decoration: null` removes yours from that path, and a decoration with no field left once cleaned — `{}`,
or a tooltip of spaces only — is the same as `null`. Setting a path again replaces your whole decoration
there — fields are not merged.

```typescript
export async function activate(ctx: SandboxContext) {
  await ctx.ui.setFileDecorations([
    { path: "notes/todo.md", decoration: { badge: "3", color: "blue", tooltip: "3 open tasks" } },
    { path: "archive", decoration: { icon: { glyph: "📦" } } },
  ]);
}
```

### What a row shows

- **Icon** — replaces the default file or folder icon: one character (`{ glyph }`), or an icon you
  defined (`{ svg: name }`). When several plugins set one, the plugin first in plugin id order wins.
- **Badges** — one or two characters each, drawn as small chips at the right end of the row, before the
  git dot, which stays right-most. A row shows two badges at most: those of the first plugins, in id
  order, that set one.
- **Hover text** — every plugin with a decoration on the row adds a line `{plugin name}: {tooltip}` (the
  badge when there is no tooltip, the name alone when there is neither), so the user can tell whose mark
  it is, even for a badge that did not fit.
- The **file name** never changes: the color reaches the badges and the icon only.

Only file tree rows show decorations — search results, tabs and the quick switcher do not.

### Colors

| Name | Drawn with |
| --- | --- |
| `red` | `--color-status-danger` |
| `orange` | `--color-git-modified` |
| `yellow` | `--color-status-warning` |
| `green` | `--color-status-success` |
| `blue` | `--color-status-info` |
| `purple` | `--color-callout-abstract` |
| `gray` | `--color-text-muted` |
| `accent` | `--color-accent-default` |

Palette names follow the theme. `#rrggbb` (six hex digits) is drawn as written and does not — prefer the
palette. Nothing else is accepted: not `#rgb`, color names, `rgb()` or `var()`. Without a color a badge
is muted and an icon takes the row's text color.

### Icons

`defineFileIcon(name, svg)` defines an icon for `icon: { svg: name }`. The name is 1–64 of `A–Z`, `a–z`,
`0–9`, `_` and `-`; the SVG is at most 8 KiB of UTF-8. Baram sanitizes it — among other things, scripts,
event handlers, `<style>` and `style` attributes, `<use>`, `<foreignObject>` and anything that would
load a resource from outside the SVG go — and what is left must be one `<svg>` element. It is drawn as
a one-color mask in the decoration's color, so draw the shape in any opaque color. A plugin defines at
most 64 icons; defining a name again replaces that icon wherever it is used. A decoration naming an
icon you have not defined refuses the whole call — a `defineFileIcon` you called earlier is applied
first, even one still waiting its turn.

### Paths

A path is at most 4,096 UTF-16 units. Trusted plugins use absolute paths. Sandboxed plugins use a path
relative to a context root: names joined by `/` — no leading `/`, no empty, `.` or `..` name, no `\` —
such as `"notes/a.md"`, or `""` for the root itself (a single-file context takes only `""`). A sandboxed
update whose path holds `\` refuses the whole call.

A sandboxed update's `context` names a registered context. Leave it out and the path is read against
the context the app shows when the call arrives — while the user switches vaults that can differ from
the one `ctx.files` uses without a context, so pass the `context` of a `PluginFileEvent` or a
`VaultChange` to be exact.
While the app shows a single-file context, a call without `context` takes only `""`.

To match a decoration to a row, Baram turns every `\` into `/` and drops a trailing separator — in your
path and in each row's path, in both tiers — and then compares the two byte for byte, with no Unicode
normalization and no case folding. So a file whose name holds `\` takes the decoration of the path with
`/` in its place, and a decomposed (NFD) and a composed (NFC) spelling of the same name are two different
paths: keep a name as Baram spelled it — do not normalize it.

### Limits and pacing

- At most 1,000 updates in one call, and 20,000 decorated paths per plugin.
- A badge is one or two characters (grapheme clusters) and at most 16 UTF-16 units; a glyph icon is one
  character within the same bound. One left blank by cleaning is refused: cleaning trims whitespace from
  both ends, and blank means empty or default-ignorable characters only (zero-width joiners, variation
  selectors). A tooltip is put on one line, and one over 120 UTF-16 units is cut, ending in `…`.
- An update over a limit, or a malformed one, refuses the **whole** call; nothing of it is applied.
- Your three methods are applied one after another, in the order you call them. Eight decoration calls
  (`setFileDecorations`, `clearFileDecorations`) are taken at once, then one every 250 ms; 64
  `defineFileIcon` calls at once, then one every 250 ms. A call beyond that **waits** — it is not
  refused — so calling them together with `Promise.all` is fine.
- Batch: one `setFileDecorations` call takes up to 1,000 updates, while decoration calls past the eighth
  are applied four a second — send a few large calls rather than many small ones.
- Waiting counts against the time your caller has: `activate` must finish within 5 seconds (a sandboxed
  plugin gets 15 in a development build of Baram), and a sandboxed command within 30. So awaiting more
  than about two dozen decoration calls in `activate`, or about 120 in a command, fails it. Batch them,
  or start them in `activate` without awaiting them and handle their rejection — the `tree-badges`
  example plugin in the Baram repository does that.
- A sandboxed call that is malformed, holds a lone surrogate (half of an emoji), or is too large for
  Baram's IPC (about 8 MiB of JSON) is refused before it is sent.

### Decorations are not saved

Baram does not keep decorations or icons when the plugin stops or the app quits: define and set them
again in `activate`, within its time limit (see above). When the plugin is turned off or reloaded, its
decorations and icons are removed and its calls still waiting their turn are rejected; a trusted
plugin's old `ctx.ui` rejects the three methods from then on. `clearFileDecorations()` removes your
decorations and keeps your icons.

## `file:rename` and `file:delete` (requires `files` or `files:readonly`)

When **Baram** renames, moves or deletes a file or folder — the file tree's rename, move and delete (to
the trash), a journal migration, a zettel promotion, a delete from the zettel inbox — your decorations on
it, and for a folder on what it held, move or go with it, and plugins holding `files` or
`files:readonly` are told:

```typescript
ctx.events.on("file:rename", (oldPath, newPath, isDir) => {}); // trusted: absolute paths
ctx.events.on("file:delete", (path, isDir) => {});

ctx.events.on("file:rename", ({ from, to, isDir }) => {}); // sandboxed: { context, path } each
ctx.events.on("file:delete", ({ context, path, isDir }) => {});
```

- A folder is one notice; what it held moved or went with it.
- Renaming a PDF in the file tree takes its companion note and geometry file along
  ([where highlights are stored](/en/docs/pdf/managing-highlights/#where-highlights-are-stored)): each one
  that moves is one more `file:rename`, after the PDF's, with `isDir` false.
- `events` is not needed. Without `files` or `files:readonly` the subscription is accepted and never
  fires. A plugin that stores paths (pinned notes, chosen icons) should declare `files:readonly` for this.
- Sandboxed: a move between nested vaults gives `from` and `to` different contexts. A notice is not sent
  when its path — for a rename, either path — is in no registered context.
- `file:rename` and `file:delete` come **before** the same change's `vault:changed`. While Baram's own
  operation runs, that vault's `vault:changed` waits for it — and keeps waiting if the operation never
  finishes. In a vault registered through a symlink or another spelling of its folder this order is not
  guaranteed. Nor is it for a PDF's rename in a vault or folder registered at or inside `highlights/` or
  `.baram/` of a vault or folder holding the PDF, when it does not hold the PDF itself.
- Nothing is told when the operation fails, for new files, for Baram's own git operations (switching
  branches, pulling, discarding changes), or for changes made outside Baram (another app, a terminal).
  Such changes reach you only as `vault:changed`. A decoration on a path deleted or renamed that way is
  not removed: it still counts toward your 20,000 paths, and a file that later appears at that path shows
  it — unless Baram's own rename or move put the file there, which clears it first.
  Use `vault:changed` and `listDir` to tidy up.
