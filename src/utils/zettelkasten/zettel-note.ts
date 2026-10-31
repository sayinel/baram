/** Zettelkasten note + frontmatter builders (pure; caller supplies id + created). */
import type { FrontmatterList } from "../markdown/frontmatter-list";

import {
  flowList,
  frontmatterListItems,
  readFrontmatterLists,
  writeFrontmatterList,
} from "../markdown/frontmatter-list";
import { yamlString } from "../markdown/yaml-scalar";
import { tagName } from "../tags/tag-name";

const RESERVED_CHARS = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "#"];
const RESERVED = new RegExp(
  `[${RESERVED_CHARS.map((c) => `\\${c}`).join("")}]`,
  "g",
);

export function buildFleetingNote(input: {
  body: string;
  created: string;
  id: string;
  /** §99 A: capture tags stored as the frontmatter `tags:` array (not inline in the body). */
  tags?: string[];
}): { content: string; filename: string } {
  const { id, body, created, tags = [] } = input;
  const filename = `${id}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `created: ${created}\n` +
    `tags: ${flowList(tags)}\n` +
    `---\n\n` +
    `${body}\n`;
  return { filename, content };
}

export function buildPermanentNote(input: {
  created: string;
  id: string;
  title: string;
}): { content: string; filename: string } {
  const { id, title, created } = input;
  const filename = `${id} ${sanitizeZettelTitle(title)}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    // §94 Quoted when YAML would not read the title back as typed (`Plan: v2`, `#1 idea`).
    `title: ${yamlString(title)}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
    `aliases: []\n` +
    `---\n\n` +
    `# ${title}\n`;
  return { filename, content };
}

/**
 * §96 The `tags:` field of a note's YAML frontmatter, as the promoted permanent note carries it
 * forward: one list read to its end (`complete`) and spaced as YAML reads it
 * (`carriesAsWritten`) is carried as written, in its own form — only an item YAML cannot read
 * is respelled (`writeFrontmatterList`), and line breaks become `\n`. Anything else — no field,
 * a field not read to its end, two `tags` keys, a list YAML reads otherwise — carries the
 * values as a new flow list (`tags: []` when there are none). Carrying the bare values wrote
 * `tags: [#idea]`, which YAML cannot parse.
 */
export function carriedTagField(md: string): string {
  const yaml = frontmatterOf(md);
  const lists = readFrontmatterLists(yaml, "tags");
  if (
    lists.length === 1 &&
    lists[0].complete &&
    carriesAsWritten(yaml, lists[0])
  ) {
    const names = lists[0].items.map((i) => tagName(i.value)).filter(Boolean);
    const respelled = writeFrontmatterList(yaml, "tags", names, tagName);
    const [list] = readFrontmatterLists(respelled, "tags");
    return respelled.slice(list.start, list.end).replace(/\r\n/g, "\n");
  }
  const values = lists.flatMap((l) => l.items).map((i) => i.value);
  return `tags: ${flowList(values)}`;
}

/**
 * §320 프론트매터 `aliases:` 배열. 태그가 대상 노트를 정하는 규칙의 두 번째 갈래다
 * (첫째는 `parseNoteTitle`). `Baram Dev Note`처럼 **공백이 있는 제목**은 태그로는
 * 닿을 수 없으므로(태그는 `is_tag_char`가 공백을 제외한다 —
 * `src-tauri/src/md/mod.rs:25`) 하이픈 별칭이 **태그 입력**이 그 노트로 가는 길이다.
 * 태그가 아닌 입력(위키링크 대상 등)은 이 제약을 받지 않는다.
 */
export function parseFrontmatterAliases(md: string): string[] {
  return frontmatterListItems(frontmatterOf(md), "aliases").map((i) => i.value);
}

export function sanitizeZettelTitle(title: string): string {
  const cleaned = title.replace(RESERVED, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}

/**
 * Whether YAML reads `list` as the list the app's readers read, so it can be carried as written.
 * The readers take any Unicode whitespace before the key's colon, after it, around a `-` and as
 * indentation (`readFrontmatterLists`). YAML takes a space or a tab around the colon and after
 * a `-`, and only spaces as indentation, and reads block lines as one list only when they are
 * indented alike. Measured with yaml 2.9.1 and js-yaml 4.3.2, which agree: `tags:[a, b]` and
 * `tags:` + U+00A0 + `[a]` are a plain scalar, not a key; a tab or a U+00A0 in the indentation
 * does not parse; `- ` + U+00A0 + `a` is an item that starts with U+00A0; `  - a` then
 * `    - b` is the one item `a - b`, and `    - a` then `  - b` does not parse. After a block
 * list's `tags:` only spaces or tabs may end the line: `tags:` + U+3000 or U+00A0 makes the key
 * line and the items one plain scalar, which beside other keys does not parse.
 */
function carriesAsWritten(yaml: string, list: FrontmatterList): boolean {
  if (!/^tags[ \t]*:$/i.test(list.key)) return false;
  const afterColon = yaml.slice(list.start + list.key.length, list.open);
  if (list.form === "inline") return /^[ \t]+$/.test(afterColon);
  if (!/^[ \t]*$/.test(afterColon)) return false;
  const indents = new Set<number>();
  for (const line of list.lines) {
    const lead = /^( *)-[ \t]+$/.exec(line.item ? line.item.lead! : line.text);
    if (!lead) return false;
    indents.add(lead[1].length);
  }
  return indents.size <= 1;
}

/**
 * 노트의 YAML 프론트매터(`---` 사이, 닫는 `---` 앞의 줄바꿈 제외), 없으면 빈 문자열.
 *
 * `tags:`와 `aliases:`가 **같은 코어**(`frontmatterListItems`)를 쓰는 이유는 한쪽만 형태를
 * 지원하게 되는 날을 막기 위해서다 — 블록 리스트로 적은 `aliases:`가 조용히 빈 배열이 되면
 * §320의 매칭이 실패하고, 캡처는 `inbox/`로 낙오한다. 조용히 실패하는 종류다.
 */
function frontmatterOf(md: string): string {
  return md.match(/^---\s*\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
}
