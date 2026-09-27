---
title: "Context: prompts"
---

## `context.prompts`

A quick pick (a filterable list) and an input box, drawn by Baram and answered back to your
plugin. Both tiers get the same two methods and no capability is needed — what bounds them is
**when** they may open.

```typescript
showQuickPick(items: QuickPickItem[], opts?: QuickPickOptions): Promise<string | undefined>;
showInputBox(opts?: InputBoxOptions): Promise<string | undefined>;

// QuickPickItem    = { id: string; label: string; description?: string }
// QuickPickOptions = { title?: string; placeholder?: string }
// InputBoxOptions  = { title?: string; placeholder?: string; value?: string }
```

`showQuickPick` resolves with the chosen item's `id`; `showInputBox` with the text typed (an
empty string is an answer). Baram filters as the user types — `label` first, then
`description` — and shows the 50 best matches; with nothing typed, the first 50 in your order.

```typescript
ctx.commands.register("insert-template", async () => {
  const id = await ctx.prompts.showQuickPick(
    templates.map((t) => ({ id: t.file, label: t.name, description: t.folder })),
    { title: "Insert template" },
  );
  if (id === undefined) return; // cancelled
  const title = await ctx.prompts.showInputBox({ placeholder: "Note title" });
  if (title === undefined) return;
  // …
});
```

## When a prompt may open

A prompt opens only while **one of your plugin's commands, started by the user, is still
running** — from the command palette or your status-bar item — and only until the user
**types or clicks outside the prompt**.

- Ask before the promise your command handler returned settles. Once it settles, and no other
  command of yours is running, requests are refused.
- The right belongs to your plugin, not to one call: while a command runs, your event handlers
  and timers may prompt too.
- The first key or click outside the prompt ends the right. Keys typed between two steps of a
  flow — after one prompt closes, before the next opens — go where focus is and end it too.
  A modifier key alone does not count.
- Cancelling ends it as well: later requests are refused until the user runs a command again.
  Picking or entering a value does not — "pick a template, then type a title" works.
- A sandboxed command has 30 seconds from its start to its first prompt, and again from each
  prompt closing to the next. Time spent in a prompt does not count.
- Clicks inside a trusted plugin's own panel, settings tab or file viewer are not commands, so
  prompts are refused there.
- A prompt is refused while another plugin's prompt is open, while focus is inside a frame
  (such as an HTML preview), or when another window covers where it would appear — and that
  last refusal ends the right, like a cancel.

## Cancelled or refused

| Result               | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| resolves `undefined` | The user cancelled: Esc, a click outside, or the command palette or Quick Switcher opening |
| rejects              | The call was refused — the reason is in the message                                     |

While your plugin is being disabled, removed or reloaded, an open prompt closes and your call
may resolve `undefined` or reject. Do not rely on either.

## Limits

| What                        | Limit            | Over the limit                         |
| --------------------------- | ---------------- | --------------------------------------- |
| Items in one quick pick     | 1–5,000          | 0 or over 5,000 rejects                |
| An item `id`                | 100 characters   | rejects — ids are compared, never cut  |
| Duplicate `id`s             | —                | rejects                                |
| `label`, `description`      | 200 characters   | cut with "…"                           |
| `title`, `placeholder`      | 100 characters   | cut with "…"                           |
| Any one string              | 4,096 characters | rejects                                |
| Input box initial `value`   | 1,000 characters | rejects                                |
| Typed input                 | 1,000 characters | the box accepts no more                |

Control characters and bidi or zero-width formatting are removed from shown text. The initial
`value` is not trimmed, but a text box drops line breaks from it. In the sandboxed tier a
request is also refused if a string holds a lone surrogate — half of an emoji, for example
from `slice` in the middle of one — or if it is over 8 MiB as sent.

The prompt carries a fixed "Plugin" badge before your plugin's name, so the user can tell your
question from the app's.

## Version floor

`context.prompts` is new. Set `engines.baram` to the first release whose notes list it — see
[Version floor](/en/docs/plugin-dev/manifest/#version-floor).
