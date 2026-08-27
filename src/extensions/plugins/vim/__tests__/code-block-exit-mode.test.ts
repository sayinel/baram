// issue 478 — 모드는 코드블록 경계에서도 커서를 따라간다 (이탈 방향).
//
// 모드는 PM 상태기계와 island별 codemirror-vim에 각자 살고, 경계는 키
// 소유권만 이양해 왔다. 진입 방향(472/475/477)은 연속인데 이탈은
// 미전파라, PM insert로 진입해 island에서 Esc(normal)를 눌러도 이탈하면
// 바깥이 insert로 "부활"했다 — 다음 키가 명령이 아니라 본문 타이핑으로
// 들어가는 사고 케이스. 이탈 시점의 island 모드가 PM 모드가 된다:
// insert/replace → insert (PM에 replace 없음), 그 외 → normal.

import { EditorView as CMEditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../index";
import {
  broadcastCodeBlockEditable,
  enterCodeBlockAt,
} from "../../../nodes/views/code-block-cm-registry";
import { createCodeBlockEscape } from "../../../nodes/views/code-block-escape";
import { type VimMode, vimPluginKey } from "../vim-keys";

if (typeof window.matchMedia !== "function") {
  window.matchMedia = () =>
    ({
      addEventListener: () => {},
      matches: false,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const zeroRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
};
Range.prototype.getBoundingClientRect ??= () => zeroRect as DOMRect;
Range.prototype.getClientRects ??= () =>
  ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
HTMLElement.prototype.getClientRects ??= Range.prototype.getClientRects;

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** 실 포커스 + suspension 체인까지 살아 있는 island를 준비한다. */
async function focusIsland(content: HTMLElement) {
  content.setAttribute("tabindex", "0");
  await vi.waitFor(() => {
    expect(content.getAttribute("contenteditable")).toBe("false");
  });
  content.focus();
  content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function islandPress(
  content: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): void {
  content.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    }),
  );
}

/** content 아래 CM 뷰의 live vim 상태. */
function islandVimState(
  content: HTMLElement,
): undefined | { insertMode?: boolean } {
  const cmv = CMEditorView.findFromDOM(content);
  const cm = cmv ? getCM(cmv) : null;
  return (cm?.state as undefined | { vim?: { insertMode?: boolean } })?.vim;
}

function makeEditor(md: string): Editor {
  const editor = new Editor({
    content: "",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

function pmMode(editor: Editor): VimMode {
  return (vimPluginKey.getState(editor.state) as { mode: VimMode }).mode;
}

/** island 간 포인터 이동의 포커스 시퀀스: focusout(from, relatedTarget=to)
 *  → to.focus() → focusin(to). 실 브라우저의 동기 순서 그대로다. */
function pointerMove(from: HTMLElement, to: HTMLElement): void {
  from.dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: to }),
  );
  to.setAttribute("tabindex", "0");
  to.focus();
  to.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

async function revealIsland(editor: Editor): Promise<HTMLElement> {
  for (const io of MockIntersectionObserver.instances) {
    io.triggerIntersect(true);
  }
  await vi.waitFor(() => {
    expect(editor.view.dom.querySelector(".cm-editor")).not.toBeNull();
  });
  return editor.view.dom.querySelector(".cm-content") as HTMLElement;
}

/** 문서의 모든 island를 공개하고 cm-content들을 문서 순서로 돌려준다. */
async function revealIslands(
  editor: Editor,
  count: number,
): Promise<HTMLElement[]> {
  for (const io of MockIntersectionObserver.instances) {
    io.triggerIntersect(true);
  }
  await vi.waitFor(() => {
    expect(editor.view.dom.querySelectorAll(".cm-editor").length).toBe(count);
  });
  return [...editor.view.dom.querySelectorAll(".cm-content")] as HTMLElement[];
}

function setVim(editor: Editor, enabled: boolean): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

describe("exit-side mode propagation (issue 478)", () => {
  it("i inside then ArrowDown exit: PM follows into INSERT", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    await vi.waitFor(() => {
      islandPress(content, "i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    islandPress(content, "ArrowDown"); // 마지막 줄 → 이탈
    await vi.waitFor(() => {
      expect(pmMode(editor)).toBe("insert");
      expect(editor.view.dom.classList.contains("vim-modal")).toBe(false);
    });
  });

  it("Esc inside then Esc exit: PM lands in NORMAL — no insert resurrection", async () => {
    const editor = makeEditor("before\n\n```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    // PM을 insert로: modal 상태에서 본문에 i
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)),
    );
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "i",
      }),
    );
    await vi.waitFor(() => {
      expect(pmMode(editor)).toBe("insert");
    });
    // 477 화살표 진입 (insert 착지)
    vi.spyOn(editor.view, "endOfTextblock").mockReturnValue(true);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      }),
    );
    content.setAttribute("tabindex", "0");
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    islandPress(content, "Escape"); // island insert → normal
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("false");
    });
    content.focus();
    islandPress(content, "Escape"); // idle normal Esc → 블록 이탈
    await vi.waitFor(() => {
      expect(document.activeElement).not.toBe(content);
      // 사용자는 Esc로 insert를 떠났다 — 경계 밖에서도 normal이어야 한다.
      expect(pmMode(editor)).toBe("normal");
    });
  });

  it("REPLACE (R) exit maps to PM insert", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    await vi.waitFor(() => {
      islandPress(content, "R");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    islandPress(content, "ArrowDown");
    await vi.waitFor(() => {
      expect(pmMode(editor)).toBe("insert");
    });
  });

  it("empty-block Backspace conversion keeps the editing session: PM insert", async () => {
    const editor = makeEditor("```ts\n\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    await vi.waitFor(() => {
      islandPress(content, "i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    islandPress(content, "Backspace");
    await vi.waitFor(() => {
      let hasCodeBlock = false;
      editor.state.doc.descendants((n) => {
        if (n.type.name === "codeBlock") hasCodeBlock = true;
        return !hasCodeBlock;
      });
      expect(hasCodeBlock).toBe(false);
      expect(pmMode(editor)).toBe("insert");
    });
  });

  it("vim OFF: the arrow exit never dispatches a mode change", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    content.focus();
    const before = pmMode(editor); // disabled sentinel
    islandPress(content, "ArrowDown"); // 비-vim 경계 이탈
    await new Promise((r) => setTimeout(r, 30));
    expect(pmMode(editor)).toBe(before);
  });

  it("no-neighbour exit: the paragraph insertion carries the mode in ONE transaction", async () => {
    // 블록이 문서 마지막 노드 — 아래로 이탈할 이웃이 없어 maybeEscape가
    // 문단을 만들어 넣는 분기. 모드 메타는 그 삽입 트랜잭션에 실린다.
    const editor = makeEditor("before\n\n```ts\nconst x = 1;\n```");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    await vi.waitFor(() => {
      islandPress(content, "i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    islandPress(content, "ArrowDown");
    await vi.waitFor(() => {
      expect(pmMode(editor)).toBe("insert");
      // 새 문단이 실제로 생겼다 (삽입 분기가 탄 증거)
      const last = editor.state.doc.lastChild;
      expect(last?.type.name).toBe("paragraph");
    });
  });

  it("boundary handoff closes an OPEN outer ex line", async () => {
    const editor = makeEditor("before\n\n```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    // PM normal에서 : 로 ex line 오픈
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)),
    );
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: ":",
      }),
    );
    await vi.waitFor(() => {
      expect(
        (vimPluginKey.getState(editor.state) as { exLine: null | string })
          .exLine,
      ).not.toBe(null);
    });
    // island로 들어갔다가 idle-normal Esc로 이탈
    await focusIsland(content);
    islandPress(content, "Escape");
    await vi.waitFor(() => {
      expect(document.activeElement).not.toBe(content);
      // 경계 핸드오프는 깨끗한 코어를 넘긴다 — 밖의 : 버퍼는 부활하지 않는다.
      expect(
        (vimPluginKey.getState(editor.state) as { exLine: null | string })
          .exLine,
      ).toBe(null);
    });
  });

  it("EXIT burns a still-armed entry memo — no off-focus insert revival", async () => {
    // 배달이 거부돼(memo armed) 남아 있는 진입 의도는, 이탈이 내는
    // "normal" publish 시점에 선택이 아직 블록 안이라 currency 검사를
    // 통과한다 — 이탈이 메모를 먼저 태우지 않으면 ensureInsert가 큐잉돼
    // 포커스가 떠난 뒤 island를 insert로 부활시킨다 (적대 리뷰 MAJOR).
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    let blockPos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (blockPos < 0 && n.type.name === "codeBlock") blockPos = pos;
      return blockPos < 0;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, blockPos + 1),
      ),
    );
    // readOnly로 insert 배달을 거부시켜 메모를 armed 상태로 만든다
    broadcastCodeBlockEditable(editor.view, false);
    enterCodeBlockAt(editor.view, blockPos, 0, 0, { vimMode: "insert" });
    await new Promise((r) => setTimeout(r, 30)); // 배달 시도(거부) 소진
    expect(content.getAttribute("contenteditable")).toBe("false");
    broadcastCodeBlockEditable(editor.view, true); // 거부 원인 해제
    islandPress(content, "ArrowDown"); // 이탈 — publish "normal"이 여기서 난다
    await vi.waitFor(() => {
      expect(document.activeElement).not.toBe(content);
    });
    await new Promise((r) => setTimeout(r, 60)); // 부활 microtask가 있다면 발화
    expect(content.getAttribute("contenteditable")).toBe("false");

    // 소각이 없다면 메모는 이탈을 살아넘는다 — 그리고 재진입 뒤의 첫
    // publish(여기서는 v의 visual publish)가 currency 검사를 통과해
    // 사용자를 visual에서 insert로 납치한다. 소각의 실전 관측점.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, blockPos + 1),
      ),
    );
    enterCodeBlockAt(editor.view, blockPos, 0, 0); // 재진입 (모드 의도 없음)
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    islandPress(content, "v");
    await new Promise((r) => setTimeout(r, 60));
    // insert로 납치됐다면 editing host가 열려 "true"가 된다 (3v: visual은
    // host 제거 상태).
    expect(content.getAttribute("contenteditable")).toBe("false");
  });

  it("vim OFF exit dispatches NO setMode metadata at all", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    content.focus();
    const metas: unknown[] = [];
    const origDispatch = editor.view.dispatch.bind(editor.view);
    vi.spyOn(editor.view, "dispatch").mockImplementation((tr) => {
      const meta = tr.getMeta(vimPluginKey) as undefined | { type?: string };
      if (meta?.type === "setMode") metas.push(meta);
      origDispatch(tr);
    });
    islandPress(content, "ArrowDown");
    await new Promise((r) => setTimeout(r, 30));
    expect(metas).toEqual([]);
  });

  it("UNIT: a getPos-less escape is a full no-op — no transaction, no mode", () => {
    const editor = makeEditor("hello\n");
    const dispatch = vi.spyOn(editor.view, "dispatch");
    const { maybeEscape } = createCodeBlockEscape(
      editor.view,
      () => undefined, // NodeView가 죽은 뒤의 getPos
      () => editor.state.doc.firstChild as never,
    );
    maybeEscape(1, "insert");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("ADJACENT blocks: an insert exit from A hands off INTO B in insert", async () => {
    // A→B 경계에서 TextSelection.near가 B 안으로 착지하는데, 핸드오프 없이
    // PM만 포커스하면 소유자가 갈리고 캐럿이 실종된다 (리뷰 MAJOR).
    const editor = makeEditor(
      "```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n",
    );
    setVim(editor, true);
    const contents = await revealIslands(editor, 2);
    const [contentA, contentB] = contents;
    await focusIsland(contentA);
    await vi.waitFor(() => {
      islandPress(contentA, "i");
      expect(contentA.getAttribute("contenteditable")).toBe("true");
    });
    islandPress(contentA, "ArrowDown"); // A 마지막 줄 → B로 이탈
    await vi.waitFor(() => {
      // B가 핸드오프를 받아 insert로 열린다 — PM insert 전파와 일치.
      expect(pmMode(editor)).toBe("insert");
      expect(contentB.getAttribute("contenteditable")).toBe("true");
      expect(contentB.contains(document.activeElement)).toBe(true);
    });
  });

  it("ADJACENT blocks: a normal exit from A hands off INTO B in normal", async () => {
    const editor = makeEditor(
      "```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n",
    );
    setVim(editor, true);
    const contents = await revealIslands(editor, 2);
    const [contentA, contentB] = contents;
    await focusIsland(contentA);
    islandPress(contentA, "j"); // idle normal 경계 j → B로 이탈
    await vi.waitFor(() => {
      expect(pmMode(editor)).toBe("normal");
      expect(contentB.getAttribute("contenteditable")).toBe("false");
      expect(contentB.contains(document.activeElement)).toBe(true);
    });
  });

  it("USER KEYDOWN burns an armed memo — v stays visual, not hijacked to insert", async () => {
    // 거부로 남은 메모가 island 체류 중 currency 검사를 통과해, 사용자의
    // v가 내는 publish에서 재시도가 발화해 visual을 insert로 납치했다
    // (리뷰 MAJOR — 프로브 재현). 사용자 키 입력 = 인수인계 종료.
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    let blockPos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (blockPos < 0 && n.type.name === "codeBlock") blockPos = pos;
      return blockPos < 0;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, blockPos + 1),
      ),
    );
    broadcastCodeBlockEditable(editor.view, false); // 배달 거부 유도
    enterCodeBlockAt(editor.view, blockPos, 0, 0, { vimMode: "insert" });
    await new Promise((r) => setTimeout(r, 30)); // 거부 소진 — 메모 잔존
    broadcastCodeBlockEditable(editor.view, true);
    islandPress(content, "v"); // 이탈 없이 island 안에서 visual
    await new Promise((r) => setTimeout(r, 60));
    // 납치됐다면 editing host가 열려 "true"가 된다 (3v: visual은 host 제거).
    expect(content.getAttribute("contenteditable")).toBe("false");
  });

  it("POINTER island→island: insert follows the click from B into A", async () => {
    // A normal, B insert에서 B→A 마우스 이동 시 A가 자기 stale 모드로
    // 열렸다 (기기 보고). 모드는 커서를 따라간다 — 포인터 경로 포함.
    const editor = makeEditor(
      "```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n",
    );
    setVim(editor, true);
    const [contentA, contentB] = await revealIslands(editor, 2);
    await focusIsland(contentB);
    await vi.waitFor(() => {
      islandPress(contentB, "i");
      expect(contentB.getAttribute("contenteditable")).toBe("true");
    });
    pointerMove(contentB, contentA);
    await vi.waitFor(() => {
      expect(contentA.getAttribute("contenteditable")).toBe("true"); // A insert
      expect(islandVimState(contentB)?.insertMode ?? false).toBe(false); // B 정규화
    });
  });

  it("POINTER island→island: a normal-mode click NORMALIZES a stale-insert target", async () => {
    const editor = makeEditor(
      "```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n",
    );
    setVim(editor, true);
    const [contentA, contentB] = await revealIslands(editor, 2);
    // A를 insert로 만들어 두고 (stale), 크롬으로 나갔다가
    await focusIsland(contentA);
    await vi.waitFor(() => {
      islandPress(contentA, "i");
      expect(contentA.getAttribute("contenteditable")).toBe("true");
    });
    // B로 포인터 이동: B는 insert(A에서 인계) — 여기서 Esc로 normal
    pointerMove(contentA, contentB);
    await vi.waitFor(() => {
      expect(contentB.getAttribute("contenteditable")).toBe("true");
    });
    islandPress(contentB, "Escape");
    await vi.waitFor(() => {
      expect(contentB.getAttribute("contenteditable")).toBe("false");
    });
    // normal인 B에서 A로 포인터 복귀: A는 stale insert가 아니라 normal
    pointerMove(contentB, contentA);
    await vi.waitFor(() => {
      expect(contentA.getAttribute("contenteditable")).toBe("false");
      expect(islandVimState(contentA)?.insertMode ?? false).toBe(false);
    });
  });

  it("POINTER to app chrome and back: the island session is PRESERVED", async () => {
    // 사이드바/검색으로 나갔다 오는 왕복은 vim의 창 포커스 복귀 관례대로
    // 세션을 보존한다 — island 간 이동과 달리 커서가 옮겨간 게 아니다.
    const editor = makeEditor("```ts\nconst a = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    await vi.waitFor(() => {
      islandPress(content, "i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    const chrome = document.createElement("input");
    document.body.appendChild(chrome);
    content.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: chrome }),
    );
    chrome.focus();
    await new Promise((r) => setTimeout(r, 30));
    // 복귀
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(content.getAttribute("contenteditable")).toBe("true"); // insert 유지
    chrome.remove();
  });

  it("POINTER island→PM body: insert follows the click out (device report)", async () => {
    // 바깥 normal + island insert에서 본문 클릭으로 나가면 PM이 normal로
    // 남았다 — 모드는 포인터 이탈에서도 커서를 따라간다.
    const editor = makeEditor("```ts\nconst a = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content);
    await vi.waitFor(() => {
      islandPress(content, "i");
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    expect(pmMode(editor)).toBe("normal"); // 바깥은 normal인 상태
    // 본문 클릭: focusout(island, rt=PM root) → PM 포커스
    const pmRoot = editor.view.dom as HTMLElement;
    content.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: pmRoot }),
    );
    pmRoot.setAttribute("tabindex", "0");
    pmRoot.focus();
    pmRoot.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.waitFor(() => {
      expect(pmMode(editor)).toBe("insert"); // 모드가 따라나옴
      expect(islandVimState(content)?.insertMode ?? false).toBe(false); // 세션 종료
    });
  });

  it("POINTER island→PM body: a normal-mode exit keeps PM normal and closes transients", async () => {
    const editor = makeEditor("before\n\n```ts\nconst a = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    await focusIsland(content); // island는 normal인 채
    const pmRoot = editor.view.dom as HTMLElement;
    content.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: pmRoot }),
    );
    pmRoot.setAttribute("tabindex", "0");
    pmRoot.focus();
    pmRoot.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(pmMode(editor)).toBe("normal");
  });
});
