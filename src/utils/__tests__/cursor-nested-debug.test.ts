// Debug: complex nested structure block alignment
import { describe, test, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { pmPosToMdOffset, mdOffsetToPmPos } from "../cursor-mapper";

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

const DOC = `# 제목

첫 번째 문단.

## 복잡한 중첩 구조

1. 첫 번째 항목

   이것은 첫 번째 항목의 내용입니다.
   \`\`\`python
   # 코드 블록도 포함
   print("nested code")
   \`\`\`
   - 중첩된 리스트
   - 다른 항목
2. 두 번째 항목
   > 인용구도 중첩 가능
   >
   > \`\`\`javascript
   > console.log("nested quote with code");
   > \`\`\`

이 문단은 중첩 구조 뒤에 있습니다.

마지막 문단.`;

describe("cursor-mapper: complex nested structure", () => {
  const editor = createEditor();

  test("block alignment: MD blocks vs PM blocks", () => {
    const doc = markdownToProsemirror(DOC, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);

    console.log("=== SERIALIZED MARKDOWN ===");
    console.log(serialized);
    console.log("=== END ===\n");

    console.log(`=== PM BLOCKS (${doc.childCount}) ===`);
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      const start = pos + (child.isLeaf ? 0 : 1);
      console.log(`  PM ${i}: ${child.type.name} nodeSize=${child.nodeSize} content.size=${child.content.size} [${start}..${start + child.content.size}] "${child.textContent.substring(0, 40)}"`);
      pos += child.nodeSize;
    }

    // Now test splitMarkdownBlocks indirectly via round-trip
    const newDoc = markdownToProsemirror(serialized, editor.schema);
    console.log(`\n=== newDoc BLOCKS (${newDoc.childCount}) ===`);
    pos = 0;
    for (let i = 0; i < newDoc.childCount; i++) {
      const child = newDoc.child(i);
      const start = pos + (child.isLeaf ? 0 : 1);
      console.log(`  newDoc ${i}: ${child.type.name} nodeSize=${child.nodeSize} [${start}..${start + child.content.size}] "${child.textContent.substring(0, 40)}"`);
      pos += child.nodeSize;
    }
    console.log(`  Match: ${doc.childCount === newDoc.childCount}`);
  });

  test("all text positions round-trip", () => {
    const doc = markdownToProsemirror(DOC, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);
    const newDoc = markdownToProsemirror(serialized, editor.schema);

    const mismatches: { pmPos: number; mdOff: number; rePmPos: number; block: string }[] = [];

    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      const start = pos + (child.isLeaf ? 0 : 1);

      const textPositions: number[] = [];
      if (child.isTextblock) {
        for (let p = start; p <= start + child.content.size; p++) {
          textPositions.push(p);
        }
      } else if (!child.isLeaf) {
        child.descendants((node, relPos) => {
          if (node.isText) {
            const absStart = start + relPos;
            for (let p = absStart; p <= absStart + node.nodeSize; p++) {
              textPositions.push(p);
            }
          }
          return true;
        });
      }

      for (const pmPos of textPositions) {
        try {
          const mdOff = pmPosToMdOffset(doc, pmPos, serialized);
          const rePmPos = mdOffsetToPmPos(newDoc, mdOff, serialized);
          if (rePmPos !== pmPos) {
            mismatches.push({
              pmPos,
              mdOff,
              rePmPos,
              block: `${child.type.name}[${i}] "${child.textContent.substring(0, 30)}"`,
            });
          }
        } catch {
          mismatches.push({
            pmPos,
            mdOff: -1,
            rePmPos: -1,
            block: `${child.type.name}[${i}] ERROR`,
          });
        }
      }

      pos += child.nodeSize;
    }

    if (mismatches.length > 0) {
      const byBlock = new Map<string, typeof mismatches>();
      for (const m of mismatches) {
        const existing = byBlock.get(m.block);
        if (!existing) byBlock.set(m.block, [m]);
        else existing.push(m);
      }
      console.log(`\n=== ${mismatches.length} MISMATCHES in ${byBlock.size} blocks ===`);
      for (const [block, ms] of byBlock) {
        const first = ms[0];
        const delta = first.rePmPos - first.pmPos;
        console.log(`  ${block}: ${ms.length} mismatches, first: PM ${first.pmPos} → MD ${first.mdOff} → PM ${first.rePmPos} (delta: ${delta > 0 ? "+" : ""}${delta})`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
