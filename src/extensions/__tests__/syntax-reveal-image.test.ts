// §300-3 이미지 reveal 회귀 가드.
//
// Task 3(클릭 가드 추출)과 Task 5(expandMediaAtom 개명 + collapse 분류기화)가
// 건드리는 동작을 리팩터링 **전에** 고정한다. syntax-reveal.test.ts에는 이미지
// 케이스가 없었다 — 이 파일이 그 공백을 메운다.
import type { Node as PmNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { forceCollapseSyntaxReveal } from "../plugins/syntax-reveal";

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

/** Find the first node of `typeName`, or null if none. */
function findNode(editor: Editor, typeName: string): null | PmNode {
  let found: null | PmNode = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === typeName) found = node;
  });
  return found;
}

/** Find the doc position of the first node of `typeName`, or -1 if none. */
function findNodePos(editor: Editor, typeName: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === typeName) found = pos;
  });
  return found;
}

/**
 * Find the doc position of `needle` inside whichever textblock contains it.
 *
 * doc.textContent concatenates textblocks with no separator between them, so
 * `doc.textContent.indexOf(needle)` does not map back to a doc position once
 * a document has more than one textblock (off by one per preceding
 * textblock boundary). Search the owning textblock's own text instead.
 */
function findTextPos(editor: Editor, needle: string): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos !== -1 || !node.isTextblock) return;
    const idx = node.textContent.indexOf(needle);
    if (idx !== -1) pos = nodePos + 1 + idx;
  });
  if (pos === -1) throw new Error(`text not found in doc: ${needle}`);
  return pos;
}

function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

/** checkNodeSelection은 plugin view의 update()에서 rAF로 확장을 예약한다. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function nodeTypeNames(editor: Editor): string[] {
  const names: string[] = [];
  editor.state.doc.descendants((node) => {
    names.push(node.type.name);
  });
  return names;
}

/**
 * Select the node at `pos` and wait for the plugin's scheduled rAF expansion
 * to run.
 *
 * checkNodeSelection's expansion (syntax-reveal.ts) is gated by a
 * `cursorAtDocChange` guard that skips expansion until the selection's
 * `.from` moves away from wherever it was right after the last doc-changing
 * transaction — this exists to stop an InputRule-created node from
 * immediately re-expanding. loadMarkdown's setContent leaves the selection
 * already resting on the image in these single-image-tail fixtures, so
 * re-selecting that same node would match the guard and the rAF would never
 * schedule an expansion. Move into the leading paragraph's text first to
 * clear the guard — the same two-step shape as syntax-reveal.test.ts's
 * moveCursorTo helper for marks/links.
 */
async function selectNodeAndAwaitExpand(
  editor: Editor,
  pos: number,
): Promise<void> {
  editor.commands.setTextSelection(1);
  editor.commands.setNodeSelection(pos);
  await nextFrame();
}

describe("image syntax reveal (§300-3 regression guard)", () => {
  it("expands a selected image into editable markdown text", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![alt text](photo.png)\n");
    expect(nodeTypeNames(editor)).toContain("image");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "image"));

    expect(editor.state.doc.textContent).toContain("![alt text](photo.png)");
    expect(nodeTypeNames(editor)).not.toContain("image");
    editor.destroy();
  });

  it("includes the title in the revealed text when present", async () => {
    const editor = createEditor();
    loadMarkdown(editor, 'Hello\n\n![a](photo.png "my title")\n');

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "image"));

    expect(editor.state.doc.textContent).toContain(
      '![a](photo.png "my title")',
    );
    editor.destroy();
  });

  it("collapses the revealed text back into an image node", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![alt text](photo.png)\n");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "image"));
    expect(nodeTypeNames(editor)).not.toContain("image");

    forceCollapseSyntaxReveal(editor.view);

    const img = findNode(editor, "image");
    expect(img).not.toBeNull();
    expect(img?.attrs.src).toBe("photo.png");
    expect(img?.attrs.alt).toBe("alt text");
    editor.destroy();
  });

  it("keeps the edited src when collapsing", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![a](old.png)\n");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "image"));

    // 노출된 텍스트에서 파일명을 바꾼다: ![a](old.png) → ![a](new.png)
    const start = findTextPos(editor, "old.png");
    editor.commands.insertContentAt(
      { from: start, to: start + "old.png".length },
      "new.png",
    );
    forceCollapseSyntaxReveal(editor.view);

    expect(findNode(editor, "image")?.attrs.src).toBe("new.png");
    editor.destroy();
  });
});
