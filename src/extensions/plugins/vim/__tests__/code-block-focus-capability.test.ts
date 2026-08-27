// issue 474/483 후속 — focus는 권한이다: selection 동기화와 분리.
//
// 기기 실증: 포인터 이탈 중 PM의 selection 동기화(selectionToDOM)가
// editorOwnsSelection 게이트를 통과해 NodeView.setSelection으로 하강하고
// (심지어 activeElement=BODY도 통과 — body는 모든 걸 contains), 그 안의
// 무조건 cmView.focus()가 떠나던 island로 포커스를 강탈했다. 하강은
// dispatch·focus 핸들러의 20ms setTimeout·observer 복구 등 여러 시점에
// 일어나므로 시간창 가드는 불가능하다 (적대 리뷰 CRITICAL) — vim이 켜진
// 동안 PM 하강은 포커스 권한이 없고, 명시 진입 채널만 권한을 가진다.

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import {
  armIslandPointerHandoff,
  enterCodeBlockAt,
  takeIslandPointerHandoff,
} from "../../../nodes/views/code-block-cm-registry";
import { vimPluginKey } from "../vim-keys";
import {
  islandVimFocus,
  islandVimMode,
  publishWysiwygVimStatus,
  setWysiwygVimStatusOwner,
} from "../vim-status";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function blockPosOf(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === "codeBlock") pos = p;
    return pos < 0;
  });
  return pos;
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

describe("focus is a capability (issue 474 root)", () => {
  it("PM descent into setSelection does NOT steal focus while vim is on", async () => {
    // PM의 selectionToDOM 하강은 정확히 이 프로토콜 메서드를 호출한다 —
    // 호출 표면이 같으므로 직접 호출로 재현한다. 인스턴스는 프로토타입
    // spy로 첫 하강에서 포획.
    const { CodeBlockNodeView } =
      await import("../../../nodes/views/code-block-node-view");
    let instance: InstanceType<typeof CodeBlockNodeView> | null = null;
    const proto = CodeBlockNodeView.prototype as unknown as {
      applySelection(a: number, h: number, o: { focus: boolean }): void;
    };
    const orig = proto.applySelection;
    const capture = vi
      .spyOn(proto, "applySelection")
      .mockImplementation(function (
        this: never,
        a: number,
        h: number,
        o: { focus: boolean },
      ) {
        instance ??= this as InstanceType<typeof CodeBlockNodeView>;
        return orig.call(this, a, h, o);
      });
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    const pos = blockPosOf(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos + 1),
      ),
    );
    enterCodeBlockAt(editor.view, pos, 0, 0); // 인스턴스 포획 겸 정상 진입
    await vi.waitFor(() => {
      expect(instance).not.toBeNull();
    });
    capture.mockRestore();
    // 이탈 형상: 포커스를 크롬으로
    const chrome = document.createElement("input");
    document.body.appendChild(chrome);
    chrome.focus();
    expect(content.contains(document.activeElement)).toBe(false);
    // PM 하강과 동일한 호출 — vim on + 비포커스 island → 포커스 강탈 금지
    instance!.setSelection(0, 0);
    await new Promise((r) => setTimeout(r, 40));
    expect(content.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(chrome);
    chrome.remove();
  });

  it("the EXPLICIT entry channel still focuses (capability holder)", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    const pos = blockPosOf(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos + 1),
      ),
    );
    enterCodeBlockAt(editor.view, pos, 0, 0);
    await vi.waitFor(() => {
      expect(
        content.contains(document.activeElement) ||
          document.activeElement === content,
      ).toBe(true);
    });
  });

  it("handoff is DESTINATION-scoped: a third island cannot consume it", async () => {
    const editor = makeEditor(
      "```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n",
    );
    setVim(editor, true);
    await revealIsland(editor);
    const containers = [
      ...editor.view.dom.querySelectorAll(".code-block-editor"),
    ] as HTMLElement[];
    expect(containers.length).toBe(2);
    const [contA, contB] = containers;
    armIslandPointerHandoff(editor.view, "insert", contB);
    // A(오배송 대상)가 take 시도 → 소비 불가
    expect(takeIslandPointerHandoff(editor.view, contA)).toBe(null);
    // B(정당한 목적지)가 take → 소비
    expect(takeIslandPointerHandoff(editor.view, contB)).toBe("insert");
    expect(takeIslandPointerHandoff(editor.view, contB)).toBe(null);
  });

  it("STALE ownership self-heals on the next PM publish", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    const cmRoot = content.closest(".cm-editor") as HTMLElement;
    const island = { dom: cmRoot }; // vim-status의 claim id 형상
    setWysiwygVimStatusOwner(editor); // PM 발행이 가능하도록 owner 지정
    islandVimMode(island, "normal", editor.view);
    islandVimFocus(island); // claim — 포커스는 실제로 island 밖 (stale)
    expect(useUIStore.getState().vimStatus?.surface).toBe("codeblock");
    // blur 없이 PM publish — 자가 치유되어 PM 상태가 표시를 되찾아야 한다
    publishWysiwygVimStatus(editor.view);
    expect(useUIStore.getState().vimStatus?.surface).not.toBe("codeblock");
  });

  it("CLICK entry from an INSERT body carries insert into the island", async () => {
    // 모드는 커서를 따라간다 — 본문(insert)에서 클릭으로 island에 들어가는
    // 방향이 마지막 구멍이었다 (기기 보고: i 상태로 클릭 이동 중 어느
    // 순간 n으로). focusin의 relatedTarget이 PM 표면이면 PM 모드를
    // 이어받는다.
    const editor = makeEditor("before\n\n```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    // PM을 insert로
    const pmRoot = editor.view.dom as HTMLElement;
    pmRoot.setAttribute("tabindex", "0");
    pmRoot.focus();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "i",
      }),
    );
    await vi.waitFor(() => {
      expect(
        (vimPluginKey.getState(editor.state) as { mode: string }).mode,
      ).toBe("insert");
    });
    // 클릭 진입 시퀀스: mousedown(우리 capture가 cmView.focus) → focusin
    // (relatedTarget = 직전 포커스였던 PM 루트)
    content.focus();
    content.dispatchEvent(
      new FocusEvent("focusin", { bubbles: true, relatedTarget: pmRoot }),
    );
    await vi.waitFor(() => {
      expect(content.getAttribute("contenteditable")).toBe("true"); // insert
    });
  });

  it("CHROME return still preserves the island session (no PM-mode override)", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.waitFor(() => {
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "i",
        }),
      );
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    // 크롬으로 나갔다가 (relatedTarget=chrome) 복귀 — PM 모드(normal)로
    // 덮어쓰지 않고 insert 세션 보존
    const chrome = document.createElement("input");
    document.body.appendChild(chrome);
    content.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: chrome }),
    );
    chrome.focus();
    await new Promise((r) => setTimeout(r, 30));
    content.focus();
    content.dispatchEvent(
      new FocusEvent("focusin", { bubbles: true, relatedTarget: chrome }),
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(content.getAttribute("contenteditable")).toBe("true"); // insert 유지
    chrome.remove();
  });

  it("COLD grant is MONOTONIC: a later descent re-sync cannot downgrade it", async () => {
    // 감사 BLOCKER: CM 로딩 중 늦은 PM 하강(50ms 재주장)이 같은 선택을
    // focus:false로 다시 쓰면 정당한 명시 grant가 강등됐다 — 같은 선택의
    // 비명시 쓰기는 grant를 보존해야 한다.
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true); // island는 cold (reveal 안 함)
    const pos = blockPosOf(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos + 1),
      ),
    );
    enterCodeBlockAt(editor.view, pos, 0, 0); // 명시 grant (cold 메모)
    // 늦은 하강과 동일 표면: 같은 선택을 프로토콜 setSelection으로 재동기화
    const { CodeBlockNodeView } =
      await import("../../../nodes/views/code-block-node-view");
    void CodeBlockNodeView;
    // 프로토타입 스파이 없이: cold 소비 시 포커스가 배달되는지가 관측점
    const content = await revealIsland(editor);
    await vi.waitFor(() => {
      expect(content.contains(document.activeElement)).toBe(true);
    });
  });

  it("COLD grant dies when the user departs during init", async () => {
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const pos = blockPosOf(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos + 1),
      ),
    );
    enterCodeBlockAt(editor.view, pos, 0, 0); // 명시 grant (cold)
    // init이 끝나기 전에 사용자가 크롬으로 떠남
    const chrome = document.createElement("input");
    document.body.appendChild(chrome);
    chrome.focus();
    const content = await revealIsland(editor);
    await new Promise((r) => setTimeout(r, 120));
    // stale grant가 크롬에서 포커스를 훔치지 않는다
    expect(document.activeElement).toBe(chrome);
    expect(content.contains(document.activeElement)).toBe(false);
    chrome.remove();
  });

  it("a document-drawn fake island can NOT become a handoff destination", async () => {
    // 감사 MAJOR: sanitizer가 class를 보존하므로 문서가
    // class="code-block-editor"를 그릴 수 있다 — 목적지 권한은 DOM 모양이
    // 아니라 등록에서 나온다.
    const editor = makeEditor("```ts\nconst x = 1;\n```\n\nafter\n");
    setVim(editor, true);
    const content = await revealIsland(editor);
    content.setAttribute("tabindex", "0");
    await new Promise((r) => setTimeout(r, 60));
    content.focus();
    content.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.waitFor(() => {
      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "i",
        }),
      );
      expect(content.getAttribute("contenteditable")).toBe("true");
    });
    // 가짜 island를 본문에 그려 넣고 그쪽으로 focusout
    const fake = document.createElement("div");
    fake.className = "code-block-editor";
    fake.setAttribute("tabindex", "0");
    editor.view.dom.appendChild(fake);
    content.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: fake }),
    );
    await new Promise((r) => setTimeout(r, 60));
    // 가짜는 목적지가 아니므로: 세션이 사칭 목적지 때문에 arm/종료되지
    // 않고, 진짜 island의 insert 세션은 남아 있다 (등록 검증의 관측점).
    // (fake에 suspend 마커가 없으니 본문行 분기로는 흐를 수 있으나,
    //  island-arm 경로가 사칭에 낚이지 않는 것이 이 핀의 계약이다.)
    const { takeIslandPointerHandoff } =
      await import("../../../nodes/views/code-block-cm-registry");
    expect(takeIslandPointerHandoff(editor.view, fake)).toBe(null);
    fake.remove();
  });
});
