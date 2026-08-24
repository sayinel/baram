import type { UseInlineAIReturn } from "../../../hooks/use-inline-ai";

import { act, render } from "@testing-library/react";
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
  scrollOffsets.current.clear();
});

// InlineAIPrompt는 phase가 "idle"이면 렌더되지 않는다 — 이 테스트의 관심사 밖이다.
const idleInlineAI = { isActive: false, phase: "idle" } as UseInlineAIReturn;

const scrollOffsets = { current: new Map<string, number>() };

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
    scrollOffsets,
    tabId: "md-1",
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

// §291 회귀 — 실앱에서 "MD 스크롤 → PDF → MD 복귀 시 문서 처음으로"로 드러났다.
//
// ‼️ 원인은 언마운트가 아니라 **기록 시점**이었다. use-tab-switching은 React 커밋의 passive
// 단계에서 나가는 컨테이너의 scrollTop을 읽었는데, 그때는 이미 display:none이 적용돼 있어
// (측정으로 확인) 0이 잡혔다. 그래서 표면을 살려 둔 뒤에도 0이 복원됐다.
//
// 아래 테스트는 그 상황을 그대로 재현한다: 스크롤한 뒤 **숨겨지면서 scrollTop이 0이 되는**
// 것까지 흉내내고, 그럼에도 돌아왔을 때 원래 값이 복원되는지 본다.
describe("MarkdownSurface scroll memory", () => {
  it("restores the offset recorded while visible, not the zero left by hiding", () => {
    const { container, rerender } = renderSurface(true);
    const wrapper = container.querySelector<HTMLElement>(".editor-area-scroll");
    expect(wrapper).not.toBeNull();

    act(() => {
      wrapper!.scrollTop = 640;
      wrapper!.dispatchEvent(new Event("scroll"));
    });

    // display:none이 레이아웃 박스를 파기해 scrollTop이 0이 되는 상황.
    rerender(<MarkdownSurface {...props(false)} />);
    wrapper!.scrollTop = 0;

    rerender(<MarkdownSurface {...props(true)} />);
    expect(wrapper!.scrollTop).toBe(640);
  });

  it("puts the offset in the shared map so use-tab-switching can restore it", () => {
    // 탭이 바뀌는 전환의 복원은 콘텐츠 설치 뒤에 도는 use-tab-switching이 한다 —
    // 같은 맵을 봐야 한다.
    const { container } = renderSurface(true);
    const wrapper = container.querySelector<HTMLElement>(".editor-area-scroll");
    act(() => {
      wrapper!.scrollTop = 315;
      wrapper!.dispatchEvent(new Event("scroll"));
    });
    expect(scrollOffsets.current.get("md-1")).toBe(315);
  });
});
