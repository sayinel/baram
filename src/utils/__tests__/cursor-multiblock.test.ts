// §5.1 Cursor mapper — multi-block document tests
// Verify cursor position drift doesn't accumulate across blocks
import { describe, test, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { pmPosToMdOffset, mdOffsetToPmPos } from "../cursor-mapper";

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

const REALISTIC_DOC = `# 프로젝트 소개

Baram은 경량 마크다운 에디터입니다.

## 주요 기능

- WYSIWYG 편집
- 소스 모드 전환
- AI 통합

> 인용문을 작성할 수 있습니다.

일반 텍스트 문단입니다.

### 코드 예시

This is **bold** and *italic* text.

- 첫 번째 항목
  - 하위 항목 A
  - 하위 항목 B
- 두 번째 항목

1. 순서 있는 목록
2. 두 번째 항목
3. 세 번째 항목

> 첫 번째 인용
>
> 두 번째 인용

마지막 문단입니다. 여기에 커서가 있으면 정확히 매핑되어야 합니다.`;

const DOC_WITH_CODE = `# Title

Some intro text.

\`\`\`js
function hello() {
  console.log("world");
}
\`\`\`

After the code block.

## Second heading

More text after code.

\`\`\`python
def greet():
    print("hello")
\`\`\`

Final paragraph here.`;

const DOC_WITH_MIXED = `---
title: Test Document
date: 2024-01-01
---

# 제목

첫 번째 문단입니다.

> 인용문 블록
> 두 번째 줄

- 목록 항목 1
- 목록 항목 2
  - 하위 항목

\`\`\`typescript
const x = 1;
\`\`\`

| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |

---

일반 텍스트 **굵은 글씨** 그리고 *기울임*.

[링크 텍스트](https://example.com)와 일반 텍스트.

> 마지막 인용문입니다.

이것은 문서의 마지막 문단입니다.`;

describe("cursor-mapper: multi-block document drift", () => {
  const editor = createEditor();

  test("document structure overview", () => {
    const doc = markdownToProsemirror(REALISTIC_DOC, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);

    console.log("=== MULTI-BLOCK DOCUMENT ===");
    console.log("Input length:", REALISTIC_DOC.length);
    console.log("Serialized length:", serialized.length);
    console.log("Block count:", doc.childCount);
    console.log("");

    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      const start = pos + (child.isLeaf ? 0 : 1);
      const end = start + child.content.size;
      const text = child.textContent.substring(0, 30);
      console.log(
        `  Block ${i}: ${child.type.name} [PM ${start}..${end}] "${text}${child.textContent.length > 30 ? "..." : ""}"`,
      );
      pos += child.nodeSize;
    }
  });

  test("round-trip every text position in the document", () => {
    const doc = markdownToProsemirror(REALISTIC_DOC, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);
    const newDoc = markdownToProsemirror(serialized, editor.schema);

    const mismatches: {
      pmPos: number;
      mdOff: number;
      rePmPos: number;
      block: string;
    }[] = [];

    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      // Leaf nodes (e.g. horizontalRule) have no opening/closing tokens
      const start = pos + (child.isLeaf ? 0 : 1);
      const end = start + child.content.size;

      // Find valid text cursor positions within this block
      const textPositions: number[] = [];
      if (child.isTextblock) {
        // Simple textblock: all positions from start to end are valid
        for (let p = start; p <= end; p++) {
          textPositions.push(p);
        }
      } else if (!child.isLeaf) {
        // Compound block: find text node positions
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
              block: `${child.type.name}[${i}] "${child.textContent.substring(0, 20)}"`,
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
      console.log(`\n=== ${mismatches.length} MISMATCHES ===`);
      for (const m of mismatches) {
        const delta = m.rePmPos - m.pmPos;
        console.log(
          `  PM ${m.pmPos} → MD ${m.mdOff} → PM ${m.rePmPos} (delta: ${delta > 0 ? "+" : ""}${delta}) in ${m.block}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  test("sample positions in each block round-trip correctly", () => {
    const doc = markdownToProsemirror(REALISTIC_DOC, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);
    const newDoc = markdownToProsemirror(serialized, editor.schema);

    // Pick a position in the middle of each block's text
    let pos = 0;
    const samples: {
      blockIdx: number;
      type: string;
      pmPos: number;
      text: string;
    }[] = [];

    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      const start = pos + (child.isLeaf ? 0 : 1);

      if (child.isTextblock && child.content.size > 0) {
        const mid = start + Math.floor(child.content.size / 2);
        samples.push({
          blockIdx: i,
          type: child.type.name,
          pmPos: mid,
          text: child.textContent.substring(0, 20),
        });
      } else if (!child.isLeaf && child.content.size > 0) {
        // For compound blocks, find the middle of the first text node
        let found = false;
        child.descendants((node, relPos) => {
          if (found) return false;
          if (node.isText && node.text!.length > 1) {
            const absPos = start + relPos + Math.floor(node.text!.length / 2);
            samples.push({
              blockIdx: i,
              type: child.type.name,
              pmPos: absPos,
              text: node.text!.substring(0, 20),
            });
            found = true;
            return false;
          }
          return true;
        });
      }

      pos += child.nodeSize;
    }

    console.log("\n=== SAMPLE POSITIONS ===");
    for (const s of samples) {
      const mdOff = pmPosToMdOffset(doc, s.pmPos, serialized);
      const rePmPos = mdOffsetToPmPos(newDoc, mdOff, serialized);
      const ok = rePmPos === s.pmPos;
      console.log(
        `  Block ${s.blockIdx} (${s.type}) PM ${s.pmPos} → MD ${mdOff} → PM ${rePmPos} ${ok ? "OK" : `*** DELTA ${rePmPos - s.pmPos} ***`} "${s.text}"`,
      );
      expect(rePmPos).toBe(s.pmPos);
    }
  });
});

// Helper: test all text positions in a document
function testAllPositions(label: string, markdown: string, editor: Editor) {
  const doc = markdownToProsemirror(markdown, editor.schema);
  const serialized = prosemirrorToMarkdown(doc);
  const newDoc = markdownToProsemirror(serialized, editor.schema);

  const mismatches: {
    pmPos: number;
    mdOff: number;
    rePmPos: number;
    block: string;
  }[] = [];

  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const start = pos + (child.isLeaf ? 0 : 1);
    const end = start + child.content.size;

    const textPositions: number[] = [];
    // For tables, end-of-cell positions are inherently ambiguous: both
    // "end of cell N text" and "start of cell N+1 text" produce the same
    // MD offset. We track these to exclude from strict round-trip checks.
    const isTable = child.type.name === "table";
    const cellEndPositions = new Set<number>();
    if (child.isTextblock) {
      for (let p = start; p <= end; p++) {
        textPositions.push(p);
      }
    } else if (!child.isLeaf) {
      const textNodes: { absEnd: number }[] = [];
      child.descendants((node, relPos) => {
        if (node.isText) {
          const absStart = start + relPos;
          const absEnd = absStart + node.nodeSize;
          textNodes.push({ absEnd });
          for (let p = absStart; p <= absEnd; p++) {
            textPositions.push(p);
          }
        }
        return true;
      });
      // In tables, intermediate cell end positions are ambiguous
      if (isTable && textNodes.length > 1) {
        for (let t = 0; t < textNodes.length - 1; t++) {
          cellEndPositions.add(textNodes[t].absEnd);
        }
      }
    }

    for (const pmPos of textPositions) {
      try {
        const mdOff = pmPosToMdOffset(doc, pmPos, serialized);
        const rePmPos = mdOffsetToPmPos(newDoc, mdOff, serialized);
        if (rePmPos !== pmPos && !cellEndPositions.has(pmPos)) {
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
    // Group by block to show first mismatch per block
    const byBlock = new Map<string, typeof mismatches>();
    for (const m of mismatches) {
      const existing = byBlock.get(m.block);
      if (!existing) byBlock.set(m.block, [m]);
      else existing.push(m);
    }
    console.log(
      `\n=== ${label}: ${mismatches.length} MISMATCHES in ${byBlock.size} blocks ===`,
    );
    for (const [block, ms] of byBlock) {
      const first = ms[0];
      const delta = first.rePmPos - first.pmPos;
      console.log(
        `  ${block}: ${ms.length} mismatches, first: PM ${first.pmPos} → MD ${first.mdOff} → PM ${first.rePmPos} (delta: ${delta > 0 ? "+" : ""}${delta})`,
      );
    }
  }

  return mismatches;
}

describe("cursor-mapper: document with code blocks", () => {
  const editor = createEditor();

  test("all text positions round-trip in doc with code blocks", () => {
    const mismatches = testAllPositions("CODE BLOCKS", DOC_WITH_CODE, editor);
    expect(mismatches).toEqual([]);
  });
});

describe("cursor-mapper: document with frontmatter+table+mixed", () => {
  const editor = createEditor();

  test("all text positions round-trip in mixed doc", () => {
    const mismatches = testAllPositions("MIXED DOC", DOC_WITH_MIXED, editor);
    expect(mismatches).toEqual([]);
  });
});
