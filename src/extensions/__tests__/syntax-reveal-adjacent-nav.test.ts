// §5.1 Syntax Reveal — 이웃 노드로 커서가 "한 라운드에" 건너갈 때의 reveal 가드.
//
// 위/아래 화살표와 클릭은 두 가지를 한 트랜잭션 라운드에 끝낸다: 앞 노드의
// collapse(문서 변경)와 다음 노드 옆 도착(셀렉션 이동). syntax-reveal.ts의
// doc-change 가드가 그 라운드 전체를 막고 있어서, 다음 노드는 화살표를 한 번
// 더 눌러야 펼쳐졌다. `- [[A]]` / `- [[B]]`처럼 **위키링크만** 든 항목이
// 연달아 있으면 펼쳐지지 않은 항목은 글자가 없어 캐럿이 보이지 않고, 결과가
// "커서가 항목을 건너뛴다"로 보인다.
//
// 좌우 화살표는 collapse와 도착이 서로 다른 라운드라 영향이 없었다 — 그래서
// 증상이 상하 이동(=리스트 항목 사이)에서만 났다.
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

// link.ts의 Cmd+click 경로가 OS opener를 부르는 것을 막는다 (syntax-reveal.test.ts와 동일).
const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { getSyntaxRevealExpanded } from "../plugins/syntax-reveal";

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  return editor;
}

/** 아직 접혀 있는 wikilink 원자의 현재 문서 위치 (펼침 상태에 따라 매번 달라진다). */
function wikilinkPos(editor: Editor, target: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === "wikilink" &&
      node.attrs.target === target
    ) {
      found = pos;
    }
  });
  if (found === -1)
    throw new Error(`no collapsed wikilink [[${target}]] in doc`);
  return found;
}

/**
 * 화살표 한 번으로 `target` 위키링크 바로 앞에 도착하는 이동.
 *
 * jsdom에는 네이티브 세로 캐럿 이동이 없으므로, ArrowDown이 만들어 내는
 * **결과**(다음 항목 문단 안, 위키링크 바로 앞)를 셀렉션으로 직접 만든다.
 * 플러그인이 보는 것은 어느 쪽이든 "문서를 안 건드린 셀렉션 트랜잭션 하나"로
 * 같다 — 그 뒤 collapse는 appendTransaction이 같은 라운드에 덧붙인다.
 */
function moveCaretBefore(editor: Editor, target: string): void {
  editor.commands.setTextSelection(wikilinkPos(editor, target));
}

describe("Syntax Reveal — caret arriving next to another node in one round (§5.1)", () => {
  it("reveals every item when walking down a list of bare wikilinks", () => {
    const editor = createEditor("- [[A]]\n- [[B]]\n- [[C]]\n- [[D]]\n");

    moveCaretBefore(editor, "A");
    expect(editor.state.doc.textContent).toContain("[[A]]");

    // ArrowDown ×3 — 항목마다 그 항목이 펼쳐져야 한다.
    for (const target of ["B", "C", "D"]) {
      moveCaretBefore(editor, target);
      expect(editor.state.doc.textContent).toContain(`[[${target}]]`);
      expect(getSyntaxRevealExpanded(editor.state)?.kind).toBe("wikilink");
    }

    editor.destroy();
  });

  it("reveals the next wikilink when the caret jumps within one paragraph", () => {
    const editor = createEditor("[[A]] and [[B]]\n");

    moveCaretBefore(editor, "A");
    expect(editor.state.doc.textContent).toContain("[[A]]");

    // 같은 문단 안의 다른 위키링크로 곧장 (클릭이 만드는 이동).
    moveCaretBefore(editor, "B");
    expect(editor.state.doc.textContent).toContain("[[B]]");
    expect(editor.state.doc.textContent).not.toContain("[[A]]");

    editor.destroy();
  });

  // ── 가드가 원래 막던 것 (§5.1, a3b17ff2) ───────────────────────────────

  it("does not re-reveal a wikilink the input rule just created", async () => {
    const editor = createEditor("start \n");
    editor.commands.focus("end");
    editor.commands.insertContentAt(editor.state.selection.from, "[[foo]]", {
      applyInputRules: true,
    });
    // input rule은 다음 macrotask에서 돈다 (task-input-rules.test.ts 참조).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wikilinkPos(editor, "foo")).toBeGreaterThan(-1);
    expect(editor.state.doc.textContent).not.toContain("[[");
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();

    editor.destroy();
  });

  it("does not re-reveal the wikilink the caret just stepped out of with ArrowRight", () => {
    const editor = createEditor("x [[A]] y\n");

    moveCaretBefore(editor, "A");
    const expanded = getSyntaxRevealExpanded(editor.state);
    expect(expanded).not.toBeNull();

    // 오른쪽 경계에서 ArrowRight → collapse + 마크 뒤로 한 칸.
    editor.commands.setTextSelection(expanded!.to);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    });
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));

    expect(editor.state.doc.textContent).not.toContain("[[");
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();

    editor.destroy();
  });
});
