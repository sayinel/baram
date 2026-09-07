// reference-links.ts — §3.3 reference 스타일 링크·이미지 → inline 형태 해석 (issue 546)
//
// md-to-pm.ts에서 분리 — `[label][ref]` · `![alt][ref]`와 그 definition을,
// 변환기가 아는 `link` · `image`로 바꾸는 pre-pass. 어떤 converter도 호출하지
// 않고 블록 워커의 공유 카운터도 쓰지 않는 standalone pass다.
//
import type {
  Definition,
  Image,
  ImageReference,
  Link,
  LinkReference,
  Root,
  Text,
} from "mdast";

/**
 * issue 546 — resolve reference-style links and images to their inline form,
 * IN PLACE, so the converters (which know `link` and `image` only) keep both
 * the text and the destination. Before this, `linkReference`, `imageReference`
 * and `definition` fell through every converter and were dropped WITH their
 * text: `see [ref][r] here` loaded as `see  here` and was saved that way.
 *
 * It runs at the editor boundary — on the tree the two converter entry points
 * receive — and NOT inside `parseMdast`, whose other consumer (the export link
 * policy, export-markdown-links.ts) reads `definition` and `linkReference`
 * nodes itself, with a different rule for duplicate definitions. It also runs
 * AFTER `enrichWithEmptyParagraphs` in every entry point, so the blank-line
 * gaps around a definition were measured while the definition was still a
 * node: its own lines never read as user-authored empty paragraphs.
 *
 * CommonMark rules: a definition applies document-wide wherever it sits
 * (inside a block quote or list item too); the FIRST definition of an
 * identifier wins; matching is by the identifier micromark already normalised
 * (case folding, collapsed whitespace). A reference with no definition is not
 * a link at all and the parser emits plain text for it — the fallback here
 * (label kept as text, alt kept as text) exists for hand-built trees only.
 *
 * The definitions are removed. A container that held nothing else keeps one
 * empty paragraph: the schema forbids an empty block quote / list item /
 * footnote definition, and deleting the container would renumber a list or
 * orphan a footnote. On save the document is written with inline links;
 * preserving the reference form byte-for-byte is a separate design (546, B).
 */
export function resolveReferenceLinks(root: Root): Root {
  const definitions = new Map<string, { title: null | string; url: string }>();
  collectAndRemoveDefinitions(root, definitions);
  if (definitions.size > 0) replaceReferences(root, definitions);
  return root;
}

/** A node as this pass sees it: a type, maybe children. */
interface MdNode {
  children?: MdNode[];
  type: string;
}

/** Document order, so the first definition of an identifier is the one kept. */
function collectAndRemoveDefinitions(
  node: MdNode,
  definitions: Map<string, { title: null | string; url: string }>,
): void {
  if (!node.children) return;
  const kept: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "definition") {
      const def = child as unknown as Definition;
      if (!definitions.has(def.identifier)) {
        definitions.set(def.identifier, {
          title: def.title ?? null,
          url: def.url,
        });
      }
      continue;
    }
    collectAndRemoveDefinitions(child, definitions);
    kept.push(child);
  }
  // A container emptied by the removal keeps one paragraph (see the header).
  if (kept.length === 0 && node.children.length > 0 && node.type !== "root") {
    kept.push({ children: [], type: "paragraph" });
  }
  node.children = kept;
}

function replaceReferences(
  node: MdNode,
  definitions: Map<string, { title: null | string; url: string }>,
): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child): MdNode[] => {
    // Depth-first: a reference's own LABEL can hold references too
    // (`[![badge][img]][ci]`). Resolve them BEFORE the child itself is
    // replaced — the new `link` reuses `ref.children` as its children, and
    // the no-definition fallback returns that same array.
    replaceReferences(child, definitions);
    if (child.type === "linkReference") {
      const ref = child as unknown as LinkReference;
      const def = definitions.get(ref.identifier);
      // Defensive only: the parser never emits a reference without a definition.
      if (!def) return ref.children as unknown as MdNode[];
      const link: Link = {
        children: ref.children,
        position: ref.position,
        title: def.title,
        type: "link",
        url: def.url,
      };
      return [link as unknown as MdNode];
    }
    if (child.type === "imageReference") {
      const ref = child as unknown as ImageReference;
      const def = definitions.get(ref.identifier);
      if (!def) {
        const text: Text = { type: "text", value: ref.alt ?? "" };
        return [text as unknown as MdNode];
      }
      const image: Image = {
        alt: ref.alt ?? null,
        position: ref.position,
        title: def.title,
        type: "image",
        url: def.url,
      };
      return [image as unknown as MdNode];
    }
    return [child];
  });
}
