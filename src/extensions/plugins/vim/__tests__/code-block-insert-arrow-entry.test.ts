// issue 477 — PM insert-mode arrow entry into code-block islands.
//
// PM insert mode is an EDITABLE view, but a vim island keeps its 3v
// editing-host barrier — the browser caret cannot step into that
// non-editable subtree, so a plain arrow skipped the whole block (device
// log: sel 5→61 in one keystroke). The fix hands off through the explicit
// entry channel and lands in INSERT.
//
// jsdom caveat (adversarial review BLOCKER 3): endOfTextblock degenerates
// to `true` under zero-geometry polyfills and synthetic keydowns have no
// native caret motion — so the layout gate is STUBBED per test and the
// real skip-over is covered by on-device verification, not here. These
// pins own the branch logic: gates, landing, insert delivery, memos.

import { EditorView as CMEditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const MD = "abcde\n\n```ts\nconst x = 1;\nyz\n```\n\nafter\n";

interface Fixture {
  blockPos: number;
  blockSize: number;
  editor: Editor;
  pmPress: (key: string, init?: KeyboardEventInit) => KeyboardEvent;
}

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** vim on + PM insert mode (i), caret placed at `pos` first. */
async function enterPmInsert(f: Fixture, pos: number): Promise<void> {
  setVim(f.editor, true);
  f.editor.view.dispatch(
    f.editor.state.tr.setSelection(
      TextSelection.create(f.editor.state.doc, pos),
    ),
  );
  await vi.waitFor(() => {
    expect(f.editor.view.dom.classList.contains("vim-modal")).toBe(true);
  });
  f.pmPress("i");
  await vi.waitFor(() => {
    expect(f.editor.view.dom.classList.contains("vim-modal")).toBe(false);
  });
}

function islandVimState(
  content: HTMLElement,
): undefined | { insertMode?: boolean } {
  const cmv = CMEditorView.findFromDOM(content);
  const cm = cmv ? getCM(cmv) : null;
  return (cm?.state as undefined | { vim?: { insertMode?: boolean } })?.vim;
}

function makeFixture(): Fixture {
  const editor = new Editor({
    content: "",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(markdownToProsemirror(MD, editor.schema).toJSON());
  editors.push(editor);
  let blockPos = -1;
  let blockSize = 0;
  editor.state.doc.descendants((n, p) => {
    if (blockPos < 0 && n.type.name === "codeBlock") {
      blockPos = p;
      blockSize = n.nodeSize;
    }
    return blockPos < 0;
  });
  const pmPress = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    });
    editor.view.dom.dispatchEvent(event);
    return event;
  };
  return { blockPos, blockSize, editor, pmPress };
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

function setVim(editor: Editor, enabled: boolean): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

describe("insert-mode arrow entry (issue 477)", () => {
  it("ArrowDown above the block: lands on the FIRST line and the island enters INSERT", async () => {
    const f = makeFixture();
    const content = await revealIsland(f.editor);
    await enterPmInsert(f, 4); // "abcde" column 3
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    const event = f.pmPress("ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    const { from } = f.editor.state.selection;
    expect(from).toBe(f.blockPos + 1 + 3); // 첫 라인, column 3 보존
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertMode).toBe(true);
    });
  });

  it("ArrowUp below the block: lands on the LAST line at insert clamp", async () => {
    const f = makeFixture();
    const content = await revealIsland(f.editor);
    // "after" 문단 column 5 — 마지막 라인 "yz"는 길이 2 → insert 클램프 2
    const afterPos = f.blockPos + f.blockSize + 1;
    await enterPmInsert(f, afterPos + 5);
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    const event = f.pmPress("ArrowUp");
    expect(event.defaultPrevented).toBe(true);
    const blockText = f.editor.state.doc.nodeAt(f.blockPos)?.textContent ?? "";
    const lastLineStart = f.blockPos + 1 + blockText.lastIndexOf("\n") + 1;
    expect(f.editor.state.selection.from).toBe(lastLineStart + 2); // 라인 END
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertMode).toBe(true);
    });
  });

  it("mid-textblock (endOfTextblock false): untouched", async () => {
    const f = makeFixture();
    await revealIsland(f.editor);
    await enterPmInsert(f, 4);
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(false);
    const before = f.editor.state.selection.from;
    const event = f.pmPress("ArrowDown");
    expect(event.defaultPrevented).toBe(false);
    expect(f.editor.state.selection.from).toBe(before);
  });

  it("Shift+ArrowDown starts a selection — never consumed", async () => {
    const f = makeFixture();
    await revealIsland(f.editor);
    await enterPmInsert(f, 4);
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    const event = f.pmPress("ArrowDown", { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(f.editor.state.selection.$from.parent.type.name).not.toBe(
      "codeBlock",
    );
  });

  it("vim off: the branch is inert", async () => {
    const f = makeFixture();
    await revealIsland(f.editor);
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    f.editor.view.dispatch(
      f.editor.state.tr.setSelection(
        TextSelection.create(f.editor.state.doc, 4),
      ),
    );
    const before = f.editor.state.selection.from;
    f.pmPress("ArrowDown");
    // vim off라서 우리 분기가 아니라 PM 기본 처리 — 블록 안으로 강제
    // 착지시키지 않았음만 고정한다 (기본 동작은 jsdom에서 부정확).
    expect(f.editor.state.selection.from).toBe(before);
  });

  it("COLD island: the entry memos insert and delivers it on attach", async () => {
    const f = makeFixture();
    await enterPmInsert(f, 4); // island는 아직 미공개(cold)
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    const event = f.pmPress("ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(f.editor.state.selection.from).toBe(f.blockPos + 1 + 3);
    const content = await revealIsland(f.editor);
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertMode).toBe(true);
    });
  });

  it("after delivery, the user's own island Esc STAYS normal (no yank back)", async () => {
    // 메모가 배달 확인 없이 남아 있으면 사용자의 Esc가 내는 normal publish가
    // 재시도를 발화해 insert로 도로 끌려간다 — 소각은 publish "insert"가
    // 확인한 순간에 일어나야 한다 (adversarial review).
    const f = makeFixture();
    const content = await revealIsland(f.editor);
    content.setAttribute("tabindex", "0");
    await enterPmInsert(f, 4);
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    f.pmPress("ArrowDown");
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertMode).toBe(true);
    });
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await vi.waitFor(() => {
      expect(islandVimState(content)?.insertMode ?? false).toBe(false);
    });
    // 재시도 microtask가 있다면 여기서 다시 insert가 됐을 것이다
    await new Promise((res) => setTimeout(res, 60));
    expect(islandVimState(content)?.insertMode ?? false).toBe(false);
  });

  it("explicit vim OFF burns a cold entry — re-enable does not replay it", async () => {
    const f = makeFixture();
    await enterPmInsert(f, 4); // island cold
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    f.pmPress("ArrowDown"); // cold 메모 arm
    setVim(f.editor, false);
    setVim(f.editor, true);
    const content = await revealIsland(f.editor);
    await new Promise((res) => setTimeout(res, 120));
    expect(islandVimState(content)?.insertMode ?? false).toBe(false);
  });

  it("STALE cold entry: selection left the block — no off-focus insert", async () => {
    const f = makeFixture();
    await enterPmInsert(f, 4);
    vi.spyOn(f.editor.view, "endOfTextblock").mockReturnValue(true);
    f.pmPress("ArrowDown");
    // 사용자가 떠났다: 선택을 블록 밖으로
    f.editor.view.dispatch(
      f.editor.state.tr.setSelection(
        TextSelection.create(f.editor.state.doc, 2),
      ),
    );
    const content = await revealIsland(f.editor);
    await new Promise((r) => setTimeout(r, 120)); // attach + publish 정착
    expect(islandVimState(content)?.insertMode ?? false).toBe(false);
    expect(document.activeElement).not.toBe(content);
  });
});
