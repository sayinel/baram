---
title: "Context: index"
---

## `context.index` (requires `files` or `files:readonly`)

Ask Baram what it already knows about a vault — which notes link to a note, which links a note
holds, its tags, its tasks, and where a phrase occurs — instead of reading every file and
parsing links yourself. The answers follow the same link, tag, task and search rules as the
app's backlinks panel, tag panel, task panel and global search, answered from one context.

```typescript
backlinks(path: string, opts?: IndexOptions): Promise<IndexBacklink[]>;
links(path: string, opts?: IndexOptions): Promise<IndexLink[]>;
notesWithTag(tag: string, opts?: IndexOptions): Promise<string[]>;
search(query: string, opts?: IndexSearchOptions): Promise<IndexSearchResult>;
tags(opts?: IndexOptions): Promise<IndexTag[]>;
tasks(opts?: IndexTaskOptions): Promise<IndexTask[]>;

// IndexOptions       = { context?: string }
// IndexTaskOptions   = IndexOptions & { file?: string; status?: "open" | "done" | "cancelled" | "all" }
// IndexSearchOptions = IndexOptions & { caseSensitive?: boolean; folder?: string;
//                                       limit?: number; regex?: boolean; word?: boolean }
```

There is no separate capability: `files` or `files:readonly` opens `ctx.index`, because
everything it returns could be read from the files themselves. Without either, the trusted tier
throws `Plugin requires "files" capability…` when you touch `ctx.index`, and the broker refuses
the sandboxed tier's calls.

## Paths and contexts

Paths follow your tier's file paths, so a row can go straight back to `ctx.files`:

- **Sandboxed** — relative to the context root and `/`-separated (`notes/a.md`). Name the
  context with `opts.context`: pass the `context` of a `PluginFileEvent` or of a
  `vault:changed`. Without it the active context answers. Absolute paths, `..` and `.baram` are
  refused, as in `ctx.files`.
- **Trusted** — absolute paths. Without `opts.context`, a read that takes a path
  (`backlinks`, `links`, `tasks` with `file`, `search` with `folder`) answers from the innermost
  vault or folder holding that path, the others from the active context.

Every read answers from **one** registered vault or folder. With a folder registered inside a
vault, ask the folder and you get only its notes; ask the vault to include the notes around it.
A context that is a single file has no index and is refused, and so is a path outside the
context you named.

## What comes back

```typescript
interface IndexBacklink { blockId: string | null; line: number; path: string; snippet: string; type: IndexLinkType }
interface IndexLink {
  blockId: string | null;
  line: number;
  path: string | null;   // when resolution is "resolved" — attachments too, as in [[Paper.pdf]]
  resolution: "otherVault" | "resolved" | "unresolved";
  target: string;        // the name in the brackets, without alias, heading or display text
  type: IndexLinkType;   // "wikilink" | "blockRef" | "blockEmbed"
  vault: string | null;  // when resolution is "otherVault": the vault alias the link names
}
interface IndexTag { count: number; tag: string }   // count = occurrences, not notes
interface IndexTask {
  path: string; line: number; state: "todo" | "doing" | "done" | "cancelled"; text: string;
  priority: number; tags: string[]; links: string[];
  created, start, scheduled, due, done, cancelled, recurrence: string | null;
}
interface IndexSearchResult { items: { line: number; path: string; snippet: string }[]; truncated: boolean }
```

- Line numbers count from 1, through front matter — the line an editor shows.
- A field with no value is `null`; no field is ever left out.
- `backlinks` is in (path, line) order with one row per line; `links` in line order; `tags` by
  count, then name; `notesWithTag` by path; `tasks` by path and line.
- `snippet` is the line the link is on, trimmed and cut at 200 bytes with `…` — for a search match, about 100 bytes either side of the match and at most 300 of the line's characters, so a long match is cut too, with a `…` at each end where it is cut (302 characters at most).

## Each read

- **`backlinks(path)`** — every link that names the note: by name (`[[a]]`), by path
  (`[[notes/a]]`), behind the vault's own alias, and block references and embeds. The note need
  not exist yet; a folder is refused.
- **`links(path)`** — the note must exist, be a note (`.md`, `.markdown`) and sit where the
  vault walk goes — not in a hidden folder or `node_modules`.
- **`tags()`** and **`notesWithTag(tag)`** — tags are compared lowercased, and every leading `#` is
  dropped — from the tag you pass and from a front-matter entry such as `tags: ["#work"]` alike — so
  that entry is the tag `work`: `tags()` counts it with `#work` in the text, and
  `notesWithTag("#Work")` finds both. An empty tag is refused.
- **`tasks(opts)`** — `status` defaults to `"open"` (todo and doing). The folders in
  **Settings → Tasks → Exclude folders** are left out here too. `file` limits the answer to one
  note.
- **`search(query, opts)`** — reads the context's `.md` files, as the app's global search does
  (`.markdown` notes are not searched). `limit` is from 1 to 1000 (default 200) and counts
  matches, not lines: two matches on one line are two rows, and `truncated` says more were
  found. `folder` moves the search into that folder, so `docs` does not also search `docs-old`.
  `regex` takes a regular expression — an invalid one is refused with the reason — and `word`
  matches whole words.

## Reading again

Answers come from disk, so text not saved yet is not in them; read the open note itself with
`ctx.editor.getMarkdown()`. Read again when
[`"vault:changed"`](/en/docs/plugin-dev/context-commands-editor-files-events/#contextevents-requires-events)
arrives for the context you asked about — it fires after the link index has caught up:

```typescript
let open: PluginFileEvent | undefined;
const refresh = async () => {
  if (!open) return;
  const links = await ctx.index.backlinks(open.path, { context: open.context });
  ctx.ui.setStatusBarText("links", `← ${links.length}`);
};
ctx.events.on("file:open", (file) => { open = file; void refresh(); });
ctx.events.on("vault:changed", ({ context }) => {
  if (open?.context === context) void refresh();
});
```

That is the sandboxed shape; `examples/plugins/link-count` in the repository does it in full,
with the open tasks next to the backlinks.

## Limits

- A sandboxed plugin's `tags`, `notesWithTag`, `tasks` and `search` each read the whole vault,
  so they share a budget: 10 back to back, then about 1 a second. A refused call says
  `rate limit exceeded`. `backlinks` and `links` read the link index and share the larger budget
  of the file operations; the first read of a context — or the first after a failed build —
  builds that index, which walks the vault. Trusted plugins have no budget here.
- A vault Baram has not opened this session sends no `vault:changed`; its link index is built on
  your first read and can go stale after edits made outside Baram.
- The errors these reads return carry only what you sent — a path, a context id, a tag or a
  query — never where the vault is. A walk that fails says `could not read the vault`; a link
  index that cannot be read says
  `the link index for this context could not be read; try again in a moment`.

## Version floor

`context.index` is new. Set `engines.baram` to the first release whose notes list it — see
[Version floor](/en/docs/plugin-dev/manifest/#version-floor).
