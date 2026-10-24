// §56m A tag's name — what the app shows after one `#`, keys colours by and filters on.

import type { TagEntry } from "../../ipc/types";

/**
 * Rows whose names agree once {@link tagName} has read them are one tag: their counts are
 * added, rows left without a name are dropped, and the result is sorted by count, then by
 * name — the order `get_vault_tags` returns.
 *
 * The rows need this because the index has listed a front-matter item with the `#` it was
 * written with: `tags: ["#solo"]` came back as `#solo` beside the body's `solo`, and the
 * panel showed that row as `##solo`.
 */
export function tagEntriesByName(entries: TagEntry[]): TagEntry[] {
  const counts = new Map<string, number>();
  for (const { count, tag } of entries) {
    const name = tagName(tag);
    if (name) counts.set(name, (counts.get(name) ?? 0) + count);
  }
  return [...counts]
    .map(([tag, count]) => ({ count, tag }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.tag < b.tag ? -1 : 1,
    );
}

/**
 * A tag's name: its spelling with every leading `#` removed — the rule the backend's
 * `tag::bare_tag` applies to a name it is asked for. `"#solo"` in front matter and `#solo` in
 * the body are the same tag, as Obsidian's `parseFrontMatterTags` reads them.
 */
export function tagName(spelling: string): string {
  return spelling.replace(/^#+/, "");
}
