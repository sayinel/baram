// convert-inline.ts — §3.3 mdast 인라인 하위트리 → ProseMirror 인라인 노드 변환
//
// md-to-pm.ts에서 분리 — 인라인 전용 변환 로직(멘션·위키링크·블록참조·태그·커스텀
// 마크 분리기, HTML 태그 기반 마크 추적)을 담는다. convertInlineChildren이
// 유일한 외부 진입점이고, 나머지 세 함수는 이 파일 안에서만 쓰인다.
import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import type { PhrasingContent, Text } from "mdast";

import {
  splitTextWithBlockRefs,
  splitTextWithCustomInlineMarks,
  splitTextWithMentions,
  splitTextWithTags,
  splitTextWithWikilinks,
} from "./convert-inline-text";
import { markTransformers, nodeTransformers } from "./transformers";

/** Convert inline mdast children to PM nodes with marks */
export function convertInlineChildren(
  children: PhrasingContent[],
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];

  // Track HTML tag-based marks: <u>, <mark>, <sub>, <sup>
  // §perf-large-file: Only rebuild marks array when HTML mark state changes
  let underlineActive = false;
  let highlightActive = false;
  let subscriptActive = false;
  let superscriptActive = false;
  let marks = parentMarks;
  let htmlMarksDirty = false;

  for (const child of children) {
    if (child.type === "html") {
      const val = (child as { value: string }).value.trim().toLowerCase();
      if (val === "<u>") {
        underlineActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</u>") {
        underlineActive = false;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "<mark>") {
        highlightActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</mark>") {
        highlightActive = false;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "<sub>") {
        subscriptActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</sub>") {
        subscriptActive = false;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "<sup>") {
        superscriptActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</sup>") {
        superscriptActive = false;
        htmlMarksDirty = true;
        continue;
      }
    }

    if (htmlMarksDirty) {
      marks = parentMarks;
      if (underlineActive && schema.marks.underline)
        marks = [...marks, schema.marks.underline.create()];
      if (highlightActive && schema.marks.highlight)
        marks = [...marks, schema.marks.highlight.create()];
      if (subscriptActive && schema.marks.subscript)
        marks = [...marks, schema.marks.subscript.create()];
      if (superscriptActive && schema.marks.superscript)
        marks = [...marks, schema.marks.superscript.create()];
      htmlMarksDirty = false;
    }
    const nodes = convertInlineNode(child, schema, marks);
    result.push(...nodes);
  }

  return result;
}

/**
 * 인라인 분리기들 — **순서가 뜻을 가진다.** 멘션(`@[[...]]`)은 위키링크의 상위집합이라
 * 반드시 먼저다.
 *
 * 각 항목은 못 찾으면 빈 배열을 돌려준다(분리기들의 기존 규약).
 */
const INLINE_SPLITTERS: ((
  text: string,
  schema: Schema,
  marks: readonly Mark[],
) => PmNode[])[] = [
  (t, s, m) =>
    s.nodes.mention && t.includes("@[[")
      ? splitTextWithMentions(t, s, [...m])
      : [],
  (t, s, m) =>
    s.nodes.wikilink && t.includes("[[")
      ? splitTextWithWikilinks(t, s, [...m])
      : [],
  (t, s, m) =>
    s.nodes.blockReference && t.includes("((")
      ? splitTextWithBlockRefs(t, s, [...m])
      : [],
  (t, s, m) =>
    s.nodes.tagNode && t.includes("#") ? splitTextWithTags(t, s, [...m]) : [],
  (t, s, m) => splitTextWithCustomInlineMarks(t, s, [...m]),
];

/**
 * 텍스트 하나를 인라인 구성요소로 쪼갠다 — 분리기를 **차례로 겹쳐** 돌린다.
 *
 * ‼️ 종전에는 먼저 걸린 분리기 하나만 돌고 early return 했다. 그래서 한 텍스트에 두
 * 구성요소가 함께 있으면 뒤엣것이 평문으로 남았다: `[[노트]] 절 쓰기 #태그`의 태그가
 * 그랬고, 링크+블록참조·링크+하이라이트도 같았다.
 *
 * 화면에서는 입력 규칙이 만든 노드가 살아 있어 멀쩡해 보이다가, 파일을 다시 열면
 * 사라진다 — 사용자에게는 "가끔 태그가 안 잡힌다"로 보이는 종류의 손실이다.
 */
function splitInlineText(
  value: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  let nodes: PmNode[] = [schema.text(value, parentMarks)];
  for (const split of INLINE_SPLITTERS) {
    nodes = nodes.flatMap((node) => {
      // 이미 노드가 된 조각은 건드리지 않는다 — 그 안의 글자는 값이지 본문이 아니다.
      if (!node.isText || !node.text) return [node];
      const out = split(node.text, schema, node.marks);
      return out.length > 0 ? out : [node];
    });
  }
  return nodes;
}

/** Convert a single inline mdast node to PM node(s) */
function convertInlineNode(
  node: PhrasingContent,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  // Text node — 인라인 구성요소로 쪼갠다(멘션·위키링크·블록참조·태그·커스텀 마크)
  if (node.type === "text") {
    const text = node as Text;
    if (!text.value) return [];
    return splitInlineText(text.value, schema, parentMarks);
  }

  // Inline code (leaf node in mdast, text with code mark in PM)
  if (node.type === "inlineCode") {
    const code = node as { value: string };
    const codeMark = schema.marks.code?.create();
    const marks = codeMark ? [...parentMarks, codeMark] : parentMarks;
    return [schema.text(code.value, marks)];
  }

  // Hard break
  if (node.type === "break") {
    return [schema.nodes.hardBreak.create()];
  }

  // Mark nodes (strong, emphasis, delete, link)
  const markTransformer = markTransformers.get(node.type);
  if (markTransformer) {
    const mark = markTransformer.mdastToMark(node, schema);
    if (mark) {
      const newMarks = [...parentMarks, mark];
      const children = (node as { children?: PhrasingContent[] }).children;
      if (children) {
        return convertInlineChildren(children, schema, newMarks);
      }
    }
  }

  // Inline math — §5.3
  if (node.type === "inlineMath") {
    const transformer = nodeTransformers.get("inlineMath");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, () => []);
      if (result && !Array.isArray(result)) return [result];
    }
  }

  // Footnote reference — §footnote
  if (node.type === "footnoteReference") {
    const fnRef = node as { identifier: string };
    if (schema.nodes.footnoteRef) {
      return [
        schema.nodes.footnoteRef.create({ identifier: fnRef.identifier }),
      ];
    }
  }

  // Image inline (rare, but possible)
  if (node.type === "image") {
    const transformer = nodeTransformers.get("image");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, () => []);
      if (result && !Array.isArray(result)) return [result];
    }
  }

  return [];
}
