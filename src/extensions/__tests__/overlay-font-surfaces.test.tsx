// §349 리뷰 Important 1 — `.tiptap` 밖으로 그려지는 오버레이가 실제로 변수를 받는지.
//
// `font-surface-containment.test.ts` 는 "분류를 빠뜨렸다"를 잡고, 이 파일은
// "분류는 했는데 배선이 없다/엉뚱한 요소에 걸었다"를 잡는다. 둘 다 필요하다:
// 원래 결함은 선택자가 존재했고 아무도 그 DOM 위치를 확인하지 않은 것이었다.
//
// ‼️ 여기 단정도 커스텀 속성의 문자열 값이다 — jsdom 은 var() 치환을 하지 않으므로
// "그 서체로 렌더된다"는 증명하지 못한다. 증명하는 것은 변수가 **그 요소에**
// 있고 소비자가 그 요소의 자손이라는 것, 즉 상속이 성립할 DOM 모양이다.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import en from "../../i18n/en.json";
import { useSettingsStore } from "../../stores/settings/store";
import { DOCUMENT_FONT_SURFACES } from "../../utils/editor/font-surfaces";
import { createBaramExtensions } from "../index";
import {
  MermaidEditFullscreenModal,
  MermaidViewFullscreenModal,
} from "../nodes/views/MermaidFullscreenModals";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const editors: Editor[] = [];

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function overlay(id: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(rootOf(id));
  if (!el) throw new Error(`${rootOf(id)} is not in the document`);
  return el;
}

/** 표면 루트 선택자는 상수에서 가져온다 — 여기 리터럴로 적으면 갈라진다. */
function rootOf(id: string): string {
  const surface = DOCUMENT_FONT_SURFACES.find((s) => s.id === id);
  if (!surface) throw new Error(`no enumerated surface "${id}"`);
  return surface.root;
}

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

beforeEach(() => {
  useSettingsStore.setState({
    codeFontFamily: "D2Coding",
    fontFamily: "Inter",
  });
});

describe("§349 portaled overlays take the font variables", () => {
  it("mermaid view fullscreen", () => {
    render(
      <MermaidViewFullscreenModal
        detectedType="flowchart"
        error={null}
        onClose={() => undefined}
        svgHtml="<svg></svg>"
      />,
    );
    expect(
      overlay("mermaid-fullscreen").style.getPropertyValue(
        "--font-family-mono",
      ),
    ).toContain('"D2Coding"');
  });

  it("mermaid edit fullscreen, and its source textarea is a descendant", () => {
    render(
      <MermaidEditFullscreenModal
        detectedType="flowchart"
        fullscreenCode="graph TD;"
        fullscreenError={null}
        fullscreenSvg="<svg></svg>"
        fullscreenTextareaRef={{ current: null }}
        onChangeCode={() => undefined}
        onClose={() => undefined}
        onDiscard={() => undefined}
      />,
    );
    const root = overlay("mermaid-fullscreen");
    expect(root.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
    // 리뷰가 지목한 그 요소다: `.mermaid-block-textarea` 가
    // `var(--font-family-mono)` 를 읽으므로 루트의 자손이어야 상속이 성립한다.
    const textarea = root.querySelector(".mermaid-block-textarea");
    expect(textarea).not.toBeNull();
    expect(root.contains(textarea)).toBe(true);
  });

  it("svg edit fullscreen", async () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    const view = render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        content: [
          { attrs: { code: SVG }, type: "svgBlock" },
          { type: "paragraph" },
        ],
        type: "doc",
      });
    });
    await flush();
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    fireEvent.click(view.getByLabelText(en["blockChrome.editFullscreen"]));
    await flush();

    const root = overlay("svg-fullscreen");
    expect(root.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
    expect(root.querySelector(".svg-block-textarea")).not.toBeNull();
  });

  // 이 팝오버는 플러그인 뷰가 `document.body.appendChild` 로 만든다 — React
  // 포털이 아니라서 리뷰의 포털 표에도 없었다. 편집기가 생기는 순간 존재한다.
  it("math inline preview popover", () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    expect(
      overlay("math-preview-popover").style.getPropertyValue(
        "--font-family-mono",
      ),
    ).toContain('"D2Coding"');
  });

  // 열려 있는 동안의 설정 변경도 따라야 한다 — 설정 창과 오버레이를 동시에
  // 열어 두는 것은 서체를 고를 때의 정상 사용 흐름이다.
  it("follows a code-font change while the overlay is open", () => {
    render(
      <MermaidViewFullscreenModal
        detectedType={null}
        error={null}
        onClose={() => undefined}
        svgHtml="<svg></svg>"
      />,
    );
    act(() => {
      useSettingsStore.setState({ codeFontFamily: "Fira Code" });
    });
    expect(
      overlay("mermaid-fullscreen").style.getPropertyValue(
        "--font-family-mono",
      ),
    ).toContain('"Fira Code"');
  });
});
