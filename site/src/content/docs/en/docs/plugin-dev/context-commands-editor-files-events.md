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

```typescript
getContent(): string;                       // plain text, not Markdown/HTML
setContent(content: string): void;          // editor only — throws under editor:readonly
getSelection(): { from: number; to: number; text: string };
insertText(text: string): void;             // editor only — throws under editor:readonly
```

`getContent()` returns the document's plain text (`editor.getText()`
internally) — not Markdown source and not HTML.

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
`ctx.editor.getContent()` reads the right document inside the handler. It also
fires when switching to a tab that was already open (not just on first open).
For non-markdown files the event still fires after the source editor loads,
but `ctx.editor` wraps the ProseMirror (markdown) editor, so `getContent()`
does not reflect code-file content.
