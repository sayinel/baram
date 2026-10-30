// §56m A tag's name — what the app shows after one `#`, keys colours by and filters on.

import type { TagEntry } from "../../ipc/types";

/**
 * One character of a part of a tag name, as the body's reader takes it — the backend's
 * `md::TAG_PART_CLASS`, `[\w\p{Script=Hangul}-]`, where Rust's Unicode `\w` is Alphabetic, a
 * mark, a decimal digit, connector punctuation or a join control. JavaScript's `\w` is ASCII
 * even with the `u` flag, so the properties are written out. The agenda's tag toggle
 * (`task-tag-token.ts`) holds the same set with `/`; a test compares the two over the Basic
 * Multilingual Plane. The Unicode tables can differ: over every code point (2026-10-30), Node
 * 24.21 (Unicode 17) takes 4699 that the backend's `regex-syntax` 0.8.11 does not, U+A7CE among
 * them — characters newer than its tables — and none the other way.
 */
export const TAG_PART_CLASS =
  "[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}\\p{Script=Hangul}-]";

/** A whole tag name the body's reader reads back from `#name`: parts joined by single `/`s. */
const BODY_TAG_NAME = new RegExp(
  `^${TAG_PART_CLASS}+(?:/${TAG_PART_CLASS}+)*$`,
  "u",
);

/**
 * Whether `name` is a tag a note's body can spell as `#name` — the rule `tag::rename_tag` puts
 * on a new name (see its doc): every character is one the body's reader takes in a tag
 * (`TAG_PART_CLASS`) or a `/` joining two non-empty parts; the name is not `-` alone (a list
 * marker to YAML); and it has a base character, one neither default-ignorable nor a combining
 * mark (a name of only Hangul fillers, ZWNJ, ZWJ or marks shows blank). The app's tag-name
 * inputs take only such names: anything else is a tag only in front matter, which the body's
 * `#` cannot reach, and a quote or a bracket there is read back as another name. The rows of
 * `src-tauri/src/tag/fixtures/frontmatter-tags.json`'s `names` pin the two languages together.
 */
export function isBodyTagName(name: string): boolean {
  return (
    BODY_TAG_NAME.test(name) &&
    name !== "-" &&
    !/^[\p{Default_Ignorable_Code_Point}\p{M}]*$/u.test(name)
  );
}

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
