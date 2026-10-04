---
title: "Context: commands, editor, files, events"
---


The `context` object passed to `activate()` exposes these APIs, each gated by
the capability (or capabilities) declared in the manifest. Signatures below
are taken verbatim from `src/plugins/types.ts` (published as
[`examples/plugins/plugin-api.d.ts`](https://github.com/sayinel/baram/blob/main/examples/plugins/plugin-api.d.ts)).

## `context.commands` (requires `commands`)

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
[Command Palette integration](/en/docs/plugin-dev/commands-and-tiptap-extensions/#command-palette-integration).

## `context.editor` (requires `editor` or `editor:readonly`)

Both tiers get the same markdown API, and every method is async. Reads need `editor` or
`editor:readonly`; writes need `editor`.

```typescript
interface EditorSelection {
  from: number;
  ref: string;
  text: string;
  to: number;
}

interface EditorInsertOptions {
  replace?: string;
}

getMarkdown(): Promise<string>;
getSelection(): Promise<EditorSelection>;
getText(): Promise<string>;                     // prose — what the status bar counts
insertMarkdown(markdown: string, opts?: EditorInsertOptions): Promise<void>; // editor only
insertText(text: string, opts?: EditorInsertOptions): Promise<void>;         // editor only
setMarkdown(markdown: string): Promise<void>;   // editor only
```

`getText()` leaves code blocks and frontmatter out. `insertText()` puts in plain text as it is;
nothing in it is parsed.

### Selections and `ref`

`getSelection()` returns ProseMirror positions, the selected text as markdown reads it
(formatting marks the editor is showing around the caret are left out), and a `ref`. Pass the
`ref` back as `replace` to replace exactly that range later:

- Edits outside the range move it along. If the text inside it changed or was deleted, the
  node you selected changed, or another document is in the editor, the write is refused and
  you read the selection again.
- A `ref` works only for the plugin that read it. A successful write spends it; a refused one
  leaves it, so you can retry. Each plugin keeps its 16 most recent unspent refs — reading a
  17th drops the oldest.
- With only `editor:readonly` you still get a `ref`, but nothing is kept for it: a write is
  refused with `not-permitted` before the `ref` is looked at.
- Without `replace`, an insert goes to the selection as it is when you call. `insertMarkdown()`
  follows that selection through its parse the same way, so it can be refused with the same
  `ref-*` codes.

### Where `insertMarkdown()` puts things

- **Text or a caret.** Inside a code block or frontmatter (both ends in the same one), or
  inside inline code, the markdown goes in as literal text. Elsewhere, a one-paragraph result
  goes in inline and keeps its marks and links — anywhere in one block of text (a paragraph,
  a heading, a table cell), or across paragraphs. Anything else (several paragraphs, a
  heading, a list, a table) goes in as blocks, and only into paragraphs: the range is cut out,
  the blocks go between the text before and after it, and a paragraph at either end of the
  result joins that text. When the range is all of one paragraph's content (an empty
  paragraph's caret, say), the blocks replace that paragraph.
- **A selected node.** One inside a line of text, such as a wikilink, counts as text. A
  selected block, such as an image or a table, is replaced by the result as whole blocks.
- **Select all.** The result replaces the document.

These are refused with `cannot-insert-here`, by `insertText()` and `insertMarkdown()` alike:

- a selection of whole table cells, or a gap cursor between two blocks — or a `ref` read
  from either;
- a range with an end inside the source the editor is showing for a wikilink (not at its
  edges), or for a block image or video (edges included).

And by `insertMarkdown()` alone:

- a range with only one end in a code block or frontmatter, or with its ends in two of them;
- a one-paragraph result over a range across two blocks of text that are not both paragraphs;
- a result that goes in as blocks, where an end of the range is not in a paragraph (an empty
  heading included) or is in a table cell, or in place of a selected node in a table cell;
- frontmatter anywhere but as the first block of a result that starts at the document's start;
- anything that would split a node above the place it goes into.

If the user's selection is inside the target when the write lands (ends included) — as it is
when you pass no `replace` and the user has not moved — the caret goes to the end of what went
in and the editor scrolls to it. Otherwise the user's selection stays where it was. Each
`insertText()` or `insertMarkdown()` is its own undo step, apart from the user's typing on
either side of it.

### Refusals

A refusal rejects with an `EditorRefusal`: an `Error` whose `code` (an `EditorRefusalCode`)
says why. Branch on `code`, not on the message.

| `code` | Why | What to do |
|---|---|---|
| `no-editor` | There is no editor at all | Tell the user |
| `surface-blocked` | The editor is not holding a markdown document: no file is open, the tab is not markdown, it is in source mode, or it is still loading or being switched to | Tell the user |
| `not-permitted` | A write with only `editor:readonly`, or — sandboxed — no editor capability | Fix the manifest |
| `budget` | Sandboxed only: the plugin's document budget is spent | Wait, then retry |
| `document-changed` | `setMarkdown()`: the document changed while your markdown was parsed | Retry |
| `ref-unknown` | The `ref` was not read by this plugin, was spent, or was dropped — or, trusted only, is malformed | Read the selection again |
| `ref-other-document` | Another document is in the editor: another tab, or the file was loaded again | Read the selection again |
| `ref-range-changed` | The text in the range changed, the range was deleted, or the selected node changed | Read again; rebuild your result if it depended on the text |
| `cannot-insert-here` | That content cannot go there (the lists above) | Change the content or the place |

An error without a `code` is something else. Among those: in the trusted tier, a plugin with
no editor capability gets a plain `Error`, thrown synchronously as soon as it reads a method of
`ctx.editor`; an exception from the markdown parser is passed through as it is; and the
sandboxed tier rejects without a `code` a request the frame check refuses (a string `length`
over 65,536 for an insert or 2,097,152 for `setMarkdown`, or a malformed `replace`), a fifth
editor request while four are in flight, a request that times out, and a transport failure.

### Moving from the old trusted API

The trusted tier used to have its own synchronous editor API. A trusted plugin written for it
breaks in four places:

| Old (trusted, sync) | Now (both tiers, async) |
|---|---|
| `getContent()` returned Tiptap's plain text (`editor.getText()`) | Removed. `await getText()` for the prose, or `await getMarkdown()` for the source |
| `setContent(content)` | Removed — the old call emptied the document. Use `await setMarkdown(markdown)` |
| `insertText(text)` parsed `text` as HTML (Tiptap's `insertContent`) | Inserts the characters as they are. Use `insertMarkdown()` for formatted content |
| `getSelection()` returned the object | Returns a Promise: without `await`, `getSelection().text` is `undefined` |

The refusals that were thrown synchronously — a write under `editor:readonly`, and the
surface checks that are now `surface-blocked` and `no-editor` — reject with a `code` instead,
so `await` every call.

## `context.files` (requires `files` or `files:readonly`)

```typescript
readFile(path: string): Promise<string>;
writeFile(path: string, content: string): Promise<void>;  // files only — throws under files:readonly
listDir(path: string): Promise<string[]>;                  // resolves to entry names, not full paths
```

## `context.events` (requires `events`)

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
`ctx.editor.getMarkdown()` reads the right document inside the handler. It also
fires when switching to a tab that was already open (not just on first open).
For non-markdown files the event still fires after the source editor loads,
but `ctx.editor` calls are refused there with `code: "surface-blocked"`.
