// §56m A tag's name — what the app shows after one `#`, keys colours by and filters on.

/**
 * A tag's name: its spelling with every leading `#` removed — the rule the backend's
 * `tag::bare_tag` applies to a name it is asked for. `"#solo"` in front matter and `#solo` in
 * the body are the same tag, as Obsidian's `parseFrontMatterTags` reads them.
 */
export function tagName(spelling: string): string {
  return spelling.replace(/^#+/, "");
}
