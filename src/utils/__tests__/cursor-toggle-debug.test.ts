// §5.1 Cursor mapper — toggle block (details/summary) tests
import { describe, test, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { pmPosToMdOffset, mdOffsetToPmPos } from "../cursor-mapper";

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

const DOC_WITH_TOGGLE = `# Title

First paragraph.

<details>
<summary>Toggle Title</summary>

Toggle body content here.

Second body paragraph.

</details>

After the toggle.

Last paragraph.`;

const DOC_WITH_NESTED_TOGGLE = `# Heading

Before toggle.

<details>
<summary>Outer Toggle</summary>

Outer body.

<details>
<summary>Inner Toggle</summary>

Inner body.

</details>

After inner.

</details>

After all toggles.`;

function testAllPositions(
  label: string,
  markdown: string,
  editor: Editor,
) {
  const doc = markdownToProsemirror(markdown, editor.schema);
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
    console.log(`\n=== ${label}: ${mismatches.length} MISMATCHES in ${byBlock.size} blocks ===`);
    for (const [block, ms] of byBlock) {
      const first = ms[0];
      const delta = first.rePmPos - first.pmPos;
      console.log(`  ${block}: ${ms.length} mismatches, first: PM ${first.pmPos} → MD ${first.mdOff} → PM ${first.rePmPos} (delta: ${delta > 0 ? "+" : ""}${delta})`);
    }
  }

  return mismatches;
}

describe("cursor-mapper: document with toggle blocks", () => {
  const editor = createEditor();

  test("all text positions round-trip with toggle block", () => {
    const mismatches = testAllPositions("TOGGLE", DOC_WITH_TOGGLE, editor);
    expect(mismatches).toEqual([]);
  });

  test("all text positions round-trip with nested toggle blocks", () => {
    const mismatches = testAllPositions("NESTED TOGGLE", DOC_WITH_NESTED_TOGGLE, editor);
    expect(mismatches).toEqual([]);
  });

  test("cursor in paragraph after toggle round-trips", () => {
    const doc = markdownToProsemirror(DOC_WITH_TOGGLE, editor.schema);
    const serialized = prosemirrorToMarkdown(doc);
    const newDoc = markdownToProsemirror(serialized, editor.schema);

    // Find the "After the toggle." paragraph (block 3)
    let pos = 0;
    for (let i = 0; i < 3; i++) {
      pos += doc.child(i).nodeSize;
    }
    const afterToggleStart = pos + 1; // +1 for paragraph opening
    const midPos = afterToggleStart + 5; // somewhere in "After"

    const mdOff = pmPosToMdOffset(doc, midPos, serialized);
    const rePmPos = mdOffsetToPmPos(newDoc, mdOff, serialized);
    expect(rePmPos).toBe(midPos);
  });
});
