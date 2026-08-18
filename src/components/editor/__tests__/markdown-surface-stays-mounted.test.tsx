import type { UseInlineAIReturn } from "../../../hooks/use-inline-ai";

import { render } from "@testing-library/react";
// §286 — 마크다운 표면은 비-MD 탭이 활성일 때도 마운트를 유지한다.
//
// ‼️ 단정을 "스크롤이 복원됐다"로 쓰지 않는다. jsdom은 레이아웃이 없어 rect가 전부 0이고
// scrollTop 클램프가 재현되지 않는다 — 그 단정은 원리적으로 불가능하다. 대신 원인을 겨눈다.
//
// 증상의 원인은 Tiptap `EditorContent.componentWillUnmount`다: 언마운트되면 nodeViews를
// 비우고 ProseMirror DOM을 **분리된 div로 옮긴다**. 그래서 `editor.view.dom.isConnected`가
// 그 원인의 유무를 정확히 관찰한다 — 언마운트가 있었다면 false, 상시 마운트라면 계속 true.
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { Paragraph } from "../../../extensions/nodes/paragraph";
import { MarkdownSurface } from "../MarkdownSurface";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

// InlineAIPrompt는 phase가 "idle"이면 렌더되지 않는다 — 이 테스트의 관심사 밖이다.
const idleInlineAI = { isActive: false, phase: "idle" } as UseInlineAIReturn;

function props(active: boolean) {
  return {
    active,
    activeEditor: editor,
    activeKeepaliveEditor: null,
    editor,
    findReplaceMode: "find" as const,
    findReplaceOpen: false,
    inlineAI: idleInlineAI,
    isParsing: false,
    mountedKeepaliveEditor: null,
    onFindReplaceClose: () => undefined,
    onFindReplaceModeChange: () => undefined,
  };
}

function renderSurface(active: boolean) {
  editor = new Editor({
    content: "<p>hello</p>",
    extensions: [Document, Paragraph, Text],
  });
  return render(<MarkdownSurface {...props(active)} />);
}

describe("MarkdownSurface", () => {
  it("keeps the ProseMirror DOM attached when it goes inactive", () => {
    const { container, rerender } = renderSurface(true);
    const pmDom = editor!.view.dom;
    const wrapper = container.querySelector(".editor-area-scroll");
    expect(pmDom.isConnected).toBe(true);

    rerender(<MarkdownSurface {...props(false)} />);

    // 언마운트가 일어났다면 Tiptap이 PM DOM을 분리된 div로 옮겼을 것이다.
    expect(editor!.view.dom).toBe(pmDom);
    expect(editor!.view.dom.isConnected).toBe(true);
    expect(container.querySelector(".editor-area-scroll")).toBe(wrapper);

    rerender(<MarkdownSurface {...props(true)} />);
    expect(editor!.view.dom).toBe(pmDom);
    expect(editor!.view.dom.isConnected).toBe(true);
  });

  it("hides itself and drops data-editor-active when inactive", () => {
    // 활성 표시가 정확해야 activeEditorScrollContainer(§288 규칙 4)가 숨은 쪽을 집지 않는다.
    const { container } = renderSurface(false);
    const wrapper = container.querySelector<HTMLElement>(".editor-area-scroll");
    expect(wrapper?.style.display).toBe("none");
    expect(wrapper?.hasAttribute("data-editor-active")).toBe(false);
  });

  it("marks itself active and visible when active", () => {
    const { container } = renderSurface(true);
    const wrapper = container.querySelector<HTMLElement>(".editor-area-scroll");
    expect(wrapper?.style.display).toBe("");
    expect(wrapper?.hasAttribute("data-editor-active")).toBe(true);
  });
});
