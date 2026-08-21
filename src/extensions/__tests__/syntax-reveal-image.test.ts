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

/** Find the doc positions of every node of `typeName`, in document order. */
function findAllNodePos(editor: Editor, typeName: string): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === typeName) positions.push(pos);
  });
  return positions;
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

  // ── Click handler path ──────────────────────────────────────────────
  //
  // syntax-reveal.ts registers a SECOND, independent expansion trigger on
  // `handleClick` (props.handleClick, ~line 303): synchronous, no rAF, no
  // `cursorAtDocChange` guard. image.ts's mousedown handler dispatches a
  // NodeSelection synchronously and does not suppress the follow-on native
  // `click`, so in the running app this handleClick path resolves BEFORE
  // checkNodeSelection's rAF-scheduled expansion ever runs — it is the
  // primary path for a real mouse/trackpad click, not the selection path
  // above. Task 3 extracts image.ts's WebKit click-guard (the mousedown
  // handler that dispatches the NodeSelection these clicks rely on), so this
  // path needs its own net.
  //
  // Not covered here: image.ts's mousedown `getBoundingClientRect` coordinate
  // fallback (for WebKit's occasionally-wrong `event.target`). jsdom reports
  // every element's bounding rect as all-zero, so the hit test there
  // degenerates to matching everything — there is no way to exercise the
  // real "did the click land on this image" logic in this environment.
  describe("click handler path (§300-3)", () => {
    it("expands via handleClick synchronously, without waiting for a frame", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello\n\n![alt text](photo.png)\n");
      const imagePos = findNodePos(editor, "image");

      const handled = editor.view.someProp("handleClick", (f) =>
        f(editor.view, imagePos, new MouseEvent("click")),
      );

      expect(handled).toBe(true);
      expect(editor.state.doc.textContent).toContain("![alt text](photo.png)");
      expect(nodeTypeNames(editor)).not.toContain("image");
      editor.destroy();
    });

    it("does not expand a second image while the first is already expanded", () => {
      // A single reused image position can't discriminate the es?.expanded
      // guard from the plain `nodeAfter.type.name === "image"` check right
      // below it: expanding always turns the clicked image into a paragraph,
      // so a second click at the SAME position would already be blocked by
      // the type check alone, guard or no guard. Two images makes the guard
      // observable: with it removed, clicking image B while A's expansion is
      // still tracked would still find `nodeAfter.type.name === "image"` at
      // B's position and expand it too, silently orphaning A's tracked range
      // (syntaxRevealKey only tracks one expanded range at a time).
      const editor = createEditor();
      loadMarkdown(editor, "Hello\n\n![a](one.png)\n\n![b](two.png)\n");
      const [posA] = findAllNodePos(editor, "image");

      editor.view.someProp("handleClick", (f) =>
        f(editor.view, posA, new MouseEvent("click")),
      );
      expect(nodeTypeNames(editor)).toContain("image"); // B is still an image

      // Re-resolve B's position: expanding A replaced a 1-size image atom with
      // a much longer paragraph of text, shifting every position after it. The
      // pre-click posB is stale and would resolve into A's new text instead.
      const posB = findNodePos(editor, "image");
      const handledB = editor.view.someProp("handleClick", (f) =>
        f(editor.view, posB, new MouseEvent("click")),
      );

      expect(handledB).toBeFalsy();
      const imgB = findNode(editor, "image");
      expect(imgB).not.toBeNull();
      expect(imgB?.attrs.src).toBe("two.png");
      editor.destroy();
    });
  });
});

describe("video syntax reveal (§295)", () => {
  // ‼️ 브리프의 원안은 "![캡션](clip.mp4)\n"처럼 문서 전체가 미디어 atom
  // 하나뿐인 픽스처에 `setNodeSelection(0)`을 직접 호출했다. `loadMarkdown`의
  // `setContent`가 이미 그 atom 위에 `NodeSelection(0,1)`을 남겨두므로, 같은
  // 위치를 다시 선택해도 `.from`이 그대로 0이라 syntax-reveal.ts의
  // `cursorAtDocChange` 가드가 절대 풀리지 않는다(재현: 소스 수정 여부와 무관
  // 하게 항상 실패). 이 파일의 기존 회귀 스위트가 쓰는 그대로 — 선행 "Hello"
  // 문단 + `selectNodeAndAwaitExpand` — 를 재사용해 가드를 정상적으로 통과시킨다.
  it("expands a selected video into the same ![](…) markdown", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![캡션](clip.mp4)\n");
    expect(nodeTypeNames(editor)).toContain("video");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "video"));

    expect(editor.state.doc.textContent).toContain("![캡션](clip.mp4)");
    expect(nodeTypeNames(editor)).not.toContain("video");
    editor.destroy();
  });

  it("collapses back into a video node (forceCollapseSyntaxReveal path)", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![](clip.mp4)\n");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "video"));
    expect(nodeTypeNames(editor)).not.toContain("video"); // sanity: expansion actually happened
    forceCollapseSyntaxReveal(editor.view);

    expect(nodeTypeNames(editor)).toContain("video");
    expect(findNode(editor, "video")?.attrs.src).toBe("clip.mp4");
    editor.destroy();
  });

  // ‼️ 이것이 kind에 "video"를 추가하는 대안이 얻지 못하는 동작이다 (§295).
  it("follows the edited src across the image/video boundary (forceCollapseSyntaxReveal path)", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![a](clip.mp4)\n");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "video"));

    // doc.textContent는 textblock 구분자를 넣지 않으므로("Hello" + revealed
    // text가 두 textblock) 그 위에서 인덱스를 찾지 않는다 — 소유 textblock 안에서
    // 찾는 findTextPos를 쓴다.
    const start = findTextPos(editor, "clip.mp4");
    editor.commands.insertContentAt(
      { from: start, to: start + "clip.mp4".length },
      "photo.png",
    );
    forceCollapseSyntaxReveal(editor.view);

    expect(nodeTypeNames(editor)).toContain("image");
    expect(nodeTypeNames(editor)).not.toContain("video");
    editor.destroy();
  });

  // §295 컨트롤러 정정: collapse는 두 곳에 있다 — forceCollapseSyntaxReveal이
  // 부르는 syntax-reveal-collapse.ts의 collapseExpanded (위 두 테스트가 그 경로)와,
  // 커서가 확장된 범위를 "벗어날 때" syntax-reveal.ts의 appendTransaction이 직접
  // 만드는 collapse 분기(두 번째, 독립된 구현)다. 위 테스트들은 전부
  // forceCollapseSyntaxReveal을 호출하므로 이 두 번째 경로를 전혀 넣지 않는다.
  // 아래는 syntax-reveal.test.ts:94 "cursor exiting expanded bold restores mark"와
  // 같은 모양으로 — 순수 커서 이동만으로 — appendTransaction 분기를 구동한다.
  it("collapses back into a video node when the cursor leaves the expanded range (appendTransaction path)", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![](clip.mp4)\n");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "video"));
    expect(nodeTypeNames(editor)).not.toContain("video");

    // 확장 범위 밖(선행 "Hello" 문단)으로 커서만 옮긴다 — forceCollapseSyntaxReveal은
    // 호출하지 않는다. 이 한 줄이 appendTransaction의 collapse 분기를 구동한다.
    editor.commands.setTextSelection(2);

    expect(nodeTypeNames(editor)).toContain("video");
    expect(findNode(editor, "video")?.attrs.src).toBe("clip.mp4");
    editor.destroy();
  });

  // 같은 두 번째 경로에서 image/video 경계 추종도 확인한다 — kind가 "video"를
  // 새로 얻지 않는다는 §295 결정은 두 collapse 구현 모두에 적용된다.
  it("follows the edited src across the image/video boundary (appendTransaction path)", async () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello\n\n![a](clip.mp4)\n");

    await selectNodeAndAwaitExpand(editor, findNodePos(editor, "video"));

    const start = findTextPos(editor, "clip.mp4");
    editor.commands.insertContentAt(
      { from: start, to: start + "clip.mp4".length },
      "photo.png",
    );
    // 확장 범위 밖으로 커서 이동 → appendTransaction이 collapse를 만든다.
    editor.commands.setTextSelection(2);

    expect(nodeTypeNames(editor)).toContain("image");
    expect(nodeTypeNames(editor)).not.toContain("video");
    editor.destroy();
  });
});
