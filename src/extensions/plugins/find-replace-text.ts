// §5.6 Find/Replace — 문서를 검색할 한 줄 문자열로 펴고, 글자마다 문서 위치를 적는다.
// 정규식 검색과 decoration 은 find-replace.ts 가 한다.

import type { Node as PmNode } from "@tiptap/pm/model";

/** Extract all text content from ProseMirror doc with position mapping.
 *  Includes text representation of inline atom nodes (tag, wikilink, etc.)
 *  so they are searchable via Find/Replace.
 *
 *  §5.6 조각을 모았다가 끝에 한 번 `join` 한다. 예전에는 글자마다 `text +=` 로 이어 붙이고
 *  block 마다 `text[text.length - 1]` 을 읽었는데, V8 은 이어 붙인 문자열을 조각 tree 로
 *  들고 있다가 색인으로 읽는 순간 전체를 펴므로 비용이 "문서 길이 × block 수" 로 늘었다
 *  (#792 측정: 글자 수 2배에 8.6배).
 *  그래서 마지막 글자는 `lastChar` 로 따라간다 — 빈 조각(`getAtomText` 의 `""`)은
 *  글자를 더하지 않으므로 바꾸지 않는다. 결과 `text`·`posMap` 은 예전 구현과 같다
 *  (`__tests__/find-replace-text.test.ts` 가 예전 구현을 oracle 로 두고 비교한다). */
export function extractTextWithPositions(doc: PmNode): {
  posMap: number[];
  text: string;
} {
  const parts: string[] = [];
  const posMap: number[] = [];
  // 지금까지 더한 마지막 글자. "" 는 아직 아무 글자도 더하지 않았다는 뜻이다.
  let lastChar = "";

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) posMap.push(pos + i);
      parts.push(node.text);
      lastChar = node.text[node.text.length - 1];
    } else if (node.isInline && node.isLeaf && !node.isText) {
      // Inline atom node — include its text representation for searchability.
      // All chars map to the atom's position so decoration spans the whole node.
      const atomText = getAtomText(node);
      if (atomText.length > 0) {
        for (let i = 0; i < atomText.length; i++) posMap.push(pos);
        parts.push(atomText);
        lastChar = atomText[atomText.length - 1];
      }
    } else if (node.isBlock && lastChar !== "" && lastChar !== "\n") {
      // Add separator between blocks to avoid matching across them
      posMap.push(-1); // sentinel — not a valid position
      parts.push("\n");
      lastChar = "\n";
    }
    return true;
  });

  return { text: parts.join(""), posMap };
}

/** Get searchable text representation of an inline atom node */
function getAtomText(node: PmNode): string {
  switch (node.type.name) {
    case "blockReference":
      return `![[${node.attrs.href}]]`;
    case "footnoteRef":
      return `[^${node.attrs.id}]`;
    case "mathInline":
      return `$${node.attrs.latex}$`;
    case "mention":
      return `@${node.attrs.id}`;
    case "tagNode":
      return `#${node.attrs.tag}`;
    case "wikiLink":
      return `[[${node.attrs.href}]]`;
    default:
      return "";
  }
}
