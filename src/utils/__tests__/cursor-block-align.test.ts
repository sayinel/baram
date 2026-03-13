import { Editor } from "@tiptap/core";
// Debug: compare MD block structure vs PM block structure
import { describe, test } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

// Replicate splitMarkdownBlocks logic to see what blocks are produced
function debugSplitMarkdownBlocks(markdown: string) {
  if (markdown.length === 0) return [];

  const lines = markdown.split("\n");
  const blocks: { end: number; start: number; text: string }[] = [];
  let blockStartLine = 0;
  let inFencedCode = false;
  let inFrontmatter = false;
  let lineOffset = 0;
  const lineOffsets: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffset);
    lineOffset += lines[i].length + 1;
  }

  if (lines[0] === "---") {
    inFrontmatter = true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFrontmatter && /^(`{3,}|~{3,})/.test(line)) {
      inFencedCode = !inFencedCode;
      continue;
    }

    if (inFrontmatter && i > 0 && line === "---") {
      inFrontmatter = false;
      continue;
    }

    if (inFencedCode || inFrontmatter) continue;

    if (line === "" && i > blockStartLine) {
      const blockStart = lineOffsets[blockStartLine];
      const blockEnd = lineOffsets[i - 1] + lines[i - 1].length;
      const text = markdown.substring(blockStart, blockEnd);
      blocks.push({
        start: blockStart,
        end: blockEnd,
        text: text.substring(0, 50),
      });
      blockStartLine = i + 1;
    } else if (line === "" && i === blockStartLine) {
      blockStartLine = i + 1;
    }
  }

  if (blockStartLine < lines.length) {
    const blockStart = lineOffsets[blockStartLine];
    const lastLine = lines.length - 1;
    const blockEnd = lineOffsets[lastLine] + lines[lastLine].length;
    const text = markdown.substring(blockStart, blockEnd);
    blocks.push({
      start: blockStart,
      end: blockEnd,
      text: text.substring(0, 50),
    });
  }

  // Enrich with empty paragraphs
  const enriched: typeof blocks = [];
  for (let i = 0; i < blocks.length; i++) {
    enriched.push(blocks[i]);
    if (i < blocks.length - 1) {
      const gapStart = blocks[i].end;
      const gapEnd = blocks[i + 1].start;
      const gap = markdown.substring(gapStart, gapEnd);
      const newlineCount = (gap.match(/\n/g) || []).length;
      const emptyParas = Math.max(0, Math.floor((newlineCount - 2) / 2));
      for (let j = 0; j < emptyParas; j++) {
        enriched.push({ start: gapEnd, end: gapEnd, text: "(empty para)" });
      }
    }
  }

  return enriched;
}

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

describe("block alignment debug", () => {
  const editor = createEditor();

  test("compare MD blocks vs PM blocks for mixed doc", () => {
    const doc = markdownToProsemirror(DOC_WITH_MIXED, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);

    console.log("=== SERIALIZED MARKDOWN ===");
    console.log(JSON.stringify(serialized).substring(0, 500));
    console.log("...");

    const mdBlocks = debugSplitMarkdownBlocks(serialized);
    console.log(`\n=== MD BLOCKS (${mdBlocks.length}) ===`);
    for (let i = 0; i < mdBlocks.length; i++) {
      console.log(
        `  MD block ${i}: [${mdBlocks[i].start}..${mdBlocks[i].end}] "${mdBlocks[i].text}"`,
      );
    }

    console.log(`\n=== PM BLOCKS (${doc.childCount}) ===`);
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      const isLeaf = child.isLeaf;
      const start = pos + (isLeaf ? 0 : 1);
      const end = start + child.content.size;
      const text = child.textContent.substring(0, 50);
      console.log(
        `  PM block ${i}: ${child.type.name} isLeaf=${isLeaf} nodeSize=${child.nodeSize} content.size=${child.content.size} [${start}..${end}] "${text}"`,
      );
      console.log(
        `    old_nextPos=${pos + child.content.size + 2}, correct_nextPos=${pos + child.nodeSize}`,
      );
      pos += child.nodeSize;
    }

    console.log(`\n=== BLOCK COUNT COMPARISON ===`);
    console.log(`  MD blocks: ${mdBlocks.length}`);
    console.log(`  PM blocks: ${doc.childCount}`);
    console.log(`  Match: ${mdBlocks.length === doc.childCount}`);

    // Compare doc vs newDoc
    const newDoc = markdownToProsemirror(serialized, editor.schema);
    console.log(`\n=== newDoc BLOCKS (${newDoc.childCount}) ===`);
    let npos = 0;
    for (let i = 0; i < newDoc.childCount; i++) {
      const child = newDoc.child(i);
      const start = npos + 1;
      const end = start + child.content.size;
      console.log(
        `  newDoc block ${i}: ${child.type.name} [${start}..${end}] "${child.textContent.substring(0, 40)}"`,
      );
      npos = end + 1;
    }
    console.log(
      `  doc.childCount === newDoc.childCount: ${doc.childCount === newDoc.childCount}`,
    );

    // Check if each block's content size matches
    for (let i = 0; i < Math.min(doc.childCount, newDoc.childCount); i++) {
      const d = doc.child(i);
      const n = newDoc.child(i);
      if (d.type.name !== n.type.name || d.content.size !== n.content.size) {
        console.log(
          `  *** Block ${i} DIFFERS: doc=${d.type.name}(${d.content.size}) vs newDoc=${n.type.name}(${n.content.size})`,
        );
      }
    }
  });
});
