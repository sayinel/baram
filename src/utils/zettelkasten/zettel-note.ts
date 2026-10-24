/** Zettelkasten note + frontmatter builders (pure; caller supplies id + created). */
import {
  flowList,
  type FrontmatterListItem,
  readFrontmatterList,
} from "../markdown/frontmatter-list";

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
    `title: ${title}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
    `aliases: []\n` +
    `---\n\n` +
    `# ${title}\n`;
  return { filename, content };
}

/**
 * The `tags:` field of a note's YAML frontmatter — inline (`tags: [a, b]`) or block-list
 * (`tags:\n  - a`) form — as the flow list `[…]` a promoted permanent note carries forward;
 * `[]` when the note has no frontmatter or no tags field. Each item keeps its spelling (quotes,
 * `#`) unless YAML would not read it back, and then it is quoted (`flowList`): carrying the
 * bare values wrote `tags: [#idea]`, which YAML cannot parse.
 */
export function carriedTagList(md: string): string {
  return flowList(frontmatterListItems(md, "tags"));
}

/**
 * §320 프론트매터 `aliases:` 배열. 태그가 대상 노트를 정하는 규칙의 두 번째 갈래다
 * (첫째는 `parseNoteTitle`). `Baram Dev Note`처럼 **공백이 있는 제목**은 태그로는
 * 닿을 수 없으므로(태그는 `is_tag_char`가 공백을 제외한다 —
 * `src-tauri/src/md/mod.rs:25`) 하이픈 별칭이 **태그 입력**이 그 노트로 가는 길이다.
 * 태그가 아닌 입력(위키링크 대상 등)은 이 제약을 받지 않는다.
 */
export function parseFrontmatterAliases(md: string): string[] {
  return frontmatterListItems(md, "aliases").map((i) => i.value);
}

export function sanitizeZettelTitle(title: string): string {
  const cleaned = title.replace(RESERVED, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}

/**
 * 프론트매터의 문자열 배열 필드 하나. 두 형태(인라인 `[a, b]`·블록 리스트)를 모두
 * 읽는다.
 *
 * `tags:`와 `aliases:`가 **같은 코어**를 쓰는 이유는 한쪽만 형태를 지원하게 되는
 * 날을 막기 위해서다 — 블록 리스트로 적은 `aliases:`가 조용히 빈 배열이 되면
 * §320의 매칭이 실패하고, 캡처는 `inbox/`로 낙오한다. 조용히 실패하는 종류다.
 */
function frontmatterListItems(
  md: string,
  field: "aliases" | "tags",
): FrontmatterListItem[] {
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  return readFrontmatterList(fmMatch[1], field)?.items ?? [];
}
