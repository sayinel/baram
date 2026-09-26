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

import type { InstalledTheme } from "../../themes/theme-install";

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

/** `components/settings/__tests__/appearance-dial-row.test.tsx` 의 픽스처 그대로. */
function installedTheme(
  dials: Record<string, number | string>,
): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "prose",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/prose",
    manifest: {
      author: "a",
      description: "d",
      dials,
      engines: { baram: ">=0.7.0" },
      id: "prose",
      license: "MIT",
      modes: { light: { tokens: "t.json" } },
      name: "prose",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
  };
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
    activeThemeId: "system",
    appearanceOverrides: {
      editorCodeFontFamily: "D2Coding",
      editorFontFamily: "Inter",
    },
    installedThemes: {},
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

  // §365 테마가 준 코드 서체도 따른다 — 이 팝오버는 React 밖이라 `readEditorTypography` 로
  // 읽는다. 사용자 층(`beforeEach` 의 D2Coding)을 비워야 테마 층이 보인다.
  it("math inline preview popover takes a theme's code font", () => {
    useSettingsStore.setState({
      activeThemeId: "prose",
      appearanceOverrides: {},
      installedThemes: {
        prose: installedTheme({ editorCodeFontFamily: "Theme Mono" }),
      },
    });
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    expect(
      overlay("math-preview-popover").style.getPropertyValue(
        "--font-family-mono",
      ),
    ).toContain('"Theme Mono"');
  });

  // §365 열린 뒤의 변경도 따른다(계획 0107 P4). 이 팝오버는 React 밖이라 설정 스토어 구독이
  // 유일한 재적용 경로다. 무엇이 이것을 실패시키는가: 구독이 재적용을 건너뛰거나 변화를 못
  // 보면(예: 병합값이 아니라 사라진 옛 필드를 비교) 마운트 때의 D2Coding · Inter 가 남는다.
  // 쓰기는 한 번이다 — 테마를 입히면서 사용자 층을 비워, 두 서체가 테마 층에서 온다.
  it("math inline preview popover follows a later theme switch", () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    const popover = overlay("math-preview-popover");
    // 출발점 — "바뀌었다" 가 공허하지 않도록 `beforeEach` 의 값부터 본다.
    expect(popover.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
    expect(popover.style.getPropertyValue("--font-family-editor")).toContain(
      '"Inter"',
    );

    useSettingsStore.setState({
      activeThemeId: "prose",
      appearanceOverrides: {},
      installedThemes: {
        prose: installedTheme({
          editorCodeFontFamily: "Theme Mono",
          editorFontFamily: "Theme Serif",
        }),
      },
    });

    expect(popover.style.getPropertyValue("--font-family-mono")).toContain(
      '"Theme Mono"',
    );
    expect(popover.style.getPropertyValue("--font-family-editor")).toContain(
      '"Theme Serif"',
    );
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
      useSettingsStore.setState({
        appearanceOverrides: {
          editorCodeFontFamily: "Fira Code",
          editorFontFamily: "Inter",
        },
      });
    });
    expect(
      overlay("mermaid-fullscreen").style.getPropertyValue(
        "--font-family-mono",
      ),
    ).toContain('"Fira Code"');
  });
});
