---
title: "Code block renderers"
---

## `context.codeBlocks` (requires `codeblocks`)

Draw a fenced code block of your own language — ```` ```backlinks ````, ```` ```chart ```` — as HTML or
SVG of your making. You return strings; Baram sanitizes them and draws them in the block, inside
a shadow root of their own. The markdown never changes: with your plugin turned off or removed,
the block is an ordinary code block with the same text.

Both tiers get the same API, and a trusted plugin also returns strings, never DOM. The types are in
`plugin-api.d.ts` (see [Using the public types](/en/docs/plugin-dev/entry-point-and-types/#using-the-public-types)).

```typescript
register(lang: string, render: CodeBlockRenderer): Disposable;
invalidate(lang?: string): void;
onAction(handler: (action: RenderedAction) => Promise<void> | void): Disposable;

// CodeBlockRenderer = (source: string, info: CodeBlockInfo)
//                       => Promise<RenderedContent> | RenderedContent
// CodeBlockInfo     = { lang: string; context: string | null; path: string | null }
// RenderedContent   = { html: string; css?: string }
// RenderedAction    = CodeBlockInfo & { action: string }
```

## Declaring languages

Declare every language in the manifest, together with the `codeblocks` capability — one without
the other is a manifest error:

```json
{
  "capabilities": ["codeblocks", "files:readonly"],
  "contributions": { "codeBlocks": [{ "lang": "backlinks" }] }
}
```

- A name matches `^[a-z0-9][a-z0-9-]{0,31}$` — what typing ```` ```backlinks-v2 ```` and a space
  produces. At most 10 per plugin, each once.
- Refused: languages Baram draws itself (`mermaid`, `query`, `svg`, `journal-…`) and every
  language its code blocks highlight, aliases included (`js`, `ts`, `python`, `py`, `md`, `yml` …).
  Taking `js` would turn every JavaScript block in the user's notes into your output.
- The consent dialog names the capability. A registry listing names no languages, so an install
  from the registry shows none; a developer folder's dialog lists them. An update that adds a
  language asks again once it is downloaded, listing the languages with the new ones marked, and
  so does **Reload** of a developer folder whose build added one.
- When two plugins declare one language, the one loaded first draws it, and the other's `register`
  throws, naming the language and the plugin that draws it.

Call `register` in `activate`. It throws for a language you did not declare. The tiers differ in
what `dispose()` and a later `register` do:

- **Trusted.** `dispose()` unbinds the renderer: the language's blocks become ordinary code blocks.
- **Sandboxed.** Baram binds the languages registered by the time `activate` finishes and keeps
  them bound until the plugin unloads. A language first registered later is not drawn.
  `dispose()` only stops your renderer answering: a block drawn after it shows an error, and a
  result Baram still keeps still shows.

In both tiers, registering a bound language again replaces its renderer and drops its kept results.

## What `info` tells you

| Field     | Sandboxed                                                                                                                    | Trusted                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `context` | the id of the registered context holding the note — a vault, a folder, or the note itself opened as a single file — or `null` | same                        |
| `path`    | relative to that context's root, `/`-separated (`""` when the context is the note itself); `null` with no context or an unsaved note | absolute; `null` if unsaved |
| `lang`    | the block's language                                                                                                         | same                        |

Put your renderer's settings in the block's text. Baram keeps a fence's language and its text but
not the rest of the opening line: ```` ```chart title="x" ```` is saved as ```` ```chart ````.

## What may come back

Baram sanitizes every result, in both tiers.

- **Elements.** Among what is removed: scripts, `<style>`, `<link>`, `<meta>` and `<base>`, frames
  and embeds (`iframe`, `object`, `embed`), forms and their inputs (`form`, `input`, `select`,
  `textarea`, `label` …), `<dialog>`, media (`video`, `audio`, `picture`, `source`, `track`),
  `<area>` and `<map>`, `<slot>`, `<template>`, SVG `use`, `animate`, `set`, `foreignObject` and
  filters, and MathML. `<button>` stays, for `data-action`.
- **Attributes.** Event handlers, `style`, `popover` and its targets, `command` and `commandfor`,
  `srcset` and `sizes` are removed.
- **URLs.** On `<a>`, `href` stays when Baram's link policy allows it. On any other element,
  `src`, `href`, `xlink:href`, `poster` and `background` stay only as `data:image/…` or a
  `#fragment` — a remote image is removed, because loading it would tell a server the note was
  opened. Fetch it with `network` and inline it as `data:`.
- **CSS in attributes.** A value that names a resource the CSS way — `url(…)`, or a function that
  takes a URL — is removed, and so is a value with a `(` that holds a `url(` or a string CSS reads
  as broken. The exception is a whole value of one unquoted `url(#id)`, an SVG paint server:
  `fill="url(#grad)"` stays, `fill="url('#grad')"` goes.
- **Size.** HTML is at most 1 MiB of UTF-8, and 30,000 element and text nodes once sanitized. A
  lone surrogate (half an emoji) in the HTML or the CSS fails the result.

CSS goes into your block's shadow root and applies there only. Refused: any `url()`, `data:` and
relative ones included, and functions that take a URL (`image-set()` …); at-rules other than
`@media`, `@supports`, `@keyframes` and `@container`; `:host`, `:host-context()`, `::slotted()`
and `::part()`; CSS Baram cannot parse, selectors included; and the text `</` — in a string too,
escaped or not — because an export writes your CSS into a `<style>` element it would close. A
comment is dropped before that check, except a top-level `/*! … */` one. `!important` is removed.
At most 64 KiB of UTF-8. The app's CSS variables reach your block, so
`var(--color-text-primary)` follows the theme.

In the editor a drawing is at most 600 px tall and scrolls past that. It does not scroll sideways:
what is wider than the block is cut off, so put wide content in an element of your own with
`overflow-x: auto`, as the example plugin does.

Removed markup is not an error. A development build (`npm run tauri dev`) writes to its web
inspector's console how many elements and attributes the sanitizer removed — at least that many.
A release build has no web inspector. Refused CSS, a result over a limit, a timeout, or an error
your renderer throws shows one line, `Render failed — ` and the reason (refused CSS names its rule,
as in `rendered CSS was refused (resourceNotAllowed)`; your own message is cut at 200 characters),
under the block's header, which names your plugin. The last drawing stays, faded.

## Clicks

Baram receives every click in your output and decides what it does. A primary click on:

- `<a href>` — an absolute `http`, `https`, `mailto` or `tel` link opens outside Baram; a
  `#fragment`, a relative link or another scheme does nothing.
- `data-note="notes/a.md"` — opens that note: a path relative to the block's context root, naming
  an existing `.md` or `.markdown` file under that root. Anything else, a block in no context, or
  a note opened as a single file opens nothing, and Baram says so.
- `data-action="name"` (1–64 characters) — calls your `onAction` handlers with the name and the
  block's `info`. Until every handler has settled,
  [`ctx.prompts`](/en/docs/plugin-dev/context-prompts/) may open: clicking your block is the user
  asking your plugin, as running one of its commands is. In the trusted tier that lasts at most 30
  seconds from the click; in the sandboxed tier the 30 seconds run as a command's do, from the
  click and again from each prompt closing. A render function gets no such right.

On one element, `data-note` comes before `data-action`, and both before `href`. A middle click
opens a link or a note but runs no action, and a right click runs none of the three. A plain click
anywhere else selects the block and shows its text for editing; dragging across your output
selects its text instead. **Show source** in the block's header shows the text until **Show
rendered** is pressed. Keys pressed on a focused element of your output — a `<button>`, an element
with `tabindex` — stay in the block: the editor does not act on them.

## Drawing again

Baram draws a block when it comes near the screen, not while its tab is hidden, and keeps recent
results by your plugin and version, the language, the note and the block's text. It draws again
when the text changes — once typing pauses, or when source editing closes — and when you call
`invalidate`:

```typescript
ctx.events.on("vault:changed", () => ctx.codeBlocks.invalidate("backlinks"));
```

`invalidate(lang)` forgets that language's results and draws its visible blocks again; a block off
screen draws when it comes into view. With no language, all of yours. Calls within a quarter
second make one redraw. It throws for a language you did not declare, and does nothing for one
another plugin draws. A render still running when you invalidate, or when your plugin is turned
off or reloaded, is thrown away.

Two renders of one plugin run at a time, and one that takes longer than 10 seconds fails. A
trusted renderer runs on the app's thread: the timeout cannot stop one that never returns control,
so keep it asynchronous.

## Export

HTML and PDF export write each block's drawing as a shadow root of its own (declarative shadow
DOM), so its CSS stays inside it. First the export draws every block whose drawing is not of its
current text, on screen or not, and waits for it within the export's time limit. A block that
never drew is exported as an ordinary code block; one whose last render failed exports the last
drawing it showed. The header and the error line are left out. Opening the HTML needs a browser
that reads declarative shadow DOM — Chrome 111 or later does — and Baram prints the PDF with your
Chrome or Chromium. Pandoc and Notion export keep the fenced code.

The example plugin `examples/plugins/backlinks-block` in the Baram repository draws
```` ```backlinks ```` as the note's backlinks with `ctx.index` and `data-note` links.

## Version floor

`context.codeBlocks` is new. Set `engines.baram` to the first release whose notes list it — see
[Version floor](/en/docs/plugin-dev/manifest/#version-floor).
