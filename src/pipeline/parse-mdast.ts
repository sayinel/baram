// §perf-large-file B1: Pure mdast parsing — no ProseMirror deps, safe for Web Worker
//
// Extracted from md-to-pm.ts so this module can be imported by both
// the main thread and a Web Worker without pulling in DOM/PM dependencies.

import type { Content, List, ListItem, Paragraph, Root } from "mdast";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** 내용 없는 체크박스 한 짝 — `- [ ]` / `- [x]` / `- [X]` */
const EMPTY_CHECKBOX_RE = /^\[([ xX])\]$/;

/** remark parser — markdown string → mdast */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);

/**
 * Detect extra blank lines between top-level blocks in the original markdown
 * and insert empty paragraph nodes into the mdast tree to preserve them.
 *
 * Markdown collapses multiple blank lines into one separator, but WYSIWYG
 * editors need to preserve empty paragraphs for the user's formatting.
 *
 * Formula: between two blocks, if the gap has N newlines,
 * empty paragraphs = floor((N - 2) / 2).
 * (2 newlines = standard separator, each additional pair = 1 empty paragraph)
 */
export function enrichWithEmptyParagraphs(root: Root, markdown: string): Root {
  const children = root.children;
  if (children.length === 0) return root;

  const enriched: Content[] = [];

  for (let i = 0; i < children.length; i++) {
    enriched.push(children[i]);

    if (i < children.length - 1) {
      const gapStart = children[i].position?.end?.offset;
      const gapEnd = children[i + 1].position?.start?.offset;

      if (gapStart != null && gapEnd != null && gapEnd > gapStart) {
        const gap = markdown.substring(gapStart, gapEnd);
        const newlineCount = (gap.match(/\n/g) || []).length;
        const emptyParas = Math.max(0, Math.floor((newlineCount - 2) / 2));

        for (let j = 0; j < emptyParas; j++) {
          enriched.push({
            type: "paragraph",
            children: [],
          } as Content);
        }
      }
    }
  }

  return { ...root, children: enriched };
}

/** Parse markdown string to mdast tree */
export function parseMdast(markdown: string): Root {
  const root = parser.parse(markdown) as Root;
  normalizeEmptyTaskItems(root);
  return root;
}

/**
 * §7.1: GFM은 **내용이 없는** 체크박스를 task로 파싱하지 않는다 — `- [ ]` 도
 * `- [ ] `(후행 공백)도 `checked: null` 에 리터럴 텍스트 `[ ]` 인 평범한
 * listItem이 된다. 그런데 사용자가 리스트를 타이핑하는 내내 문서 끝에 있는
 * 것이 바로 그 "빈 task item"이고, 자동 저장은 기본값이다. GFM에 맡기면
 * 저장 → 재열기 한 번에 체크박스가 사라진다.
 *
 * 그래서 파싱 직후 그 자리를 되돌려 놓는다: 첫 자식이 `[ ]`/`[x]` 하나뿐인
 * 문단인 listItem은 checked를 세우고 그 문단을 비운다. `pm-to-md` 쪽 대칭
 * 처리는 `task-list-transformer.ts` 에 있다.
 *
 * 건드리지 않는 것:
 * - 순서 있는 리스트 — taskList는 불릿 전용이라 승격하면 번호를 잃는다.
 * - `- [ ]x` 처럼 체크박스 뒤에 공백 없이 글자가 붙는 줄 (GFM도 task가 아니다).
 * - 첫 문단이 `[ ]` "로 시작"만 하는 줄 — 정확히 그 세 글자일 때만 본다.
 */
function normalizeEmptyTaskItems(node: Content | Root): void {
  const children = (node as { children?: Content[] }).children;
  if (!children) return;

  if (node.type === "list" && !(node as List).ordered) {
    for (const child of children) {
      if (child.type !== "listItem") continue;
      const item = child as ListItem;
      if (item.checked != null) continue;

      const head = item.children[0] as Paragraph | undefined;
      if (!head || head.type !== "paragraph") continue;
      if (head.children.length !== 1) continue;

      const only = head.children[0];
      if (only.type !== "text") continue;
      const match = EMPTY_CHECKBOX_RE.exec(only.value);
      if (!match) continue;

      item.checked = match[1] !== " ";
      head.children = [];
    }
  }

  for (const child of children) normalizeEmptyTaskItems(child);
}
