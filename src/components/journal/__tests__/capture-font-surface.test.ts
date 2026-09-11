// §349 캡처 표면 — 문서창과 같은 서체로 뜬다.
//
// 캡처 편집기는 **별개 Tiptap 인스턴스**이고, 서체를 배선하는 훅
// (`use-settings-effects.ts`)은 `editor.view.dom` 으로 활성 편집기 하나만 겨눈다
// (그 파일의 §perf-large-file C3.4 주석). 그래서 문서창만 배선하면 캡처 상자가
// 사용자가 고른 서체를 무시하고 뜬다 — 그게 §346 이 남긴 모양이었다.
//
// ‼️ 여기의 단정은 커스텀 속성의 문자열 값이다. jsdom 은 var() 치환을 하지
// 않으므로 "그 서체로 렌더된다"는 이 파일이 증명하지 못한다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { useCaptureEditor } from "../use-capture-editor";

/** 캡처 편집기의 표면 요소 — 문서창과 같은 `.tiptap` 이다. */
function surfaceOf(editor: null | { view: { dom: HTMLElement } }): HTMLElement {
  if (!editor) throw new Error("capture editor was never created");
  return editor.view.dom;
}

describe("§349 capture editor font surface", () => {
  beforeEach(() => {
    useSettingsStore.setState({ codeFontFamily: "", fontFamily: "" });
  });

  it("sets both font variables on its own editor surface", () => {
    useSettingsStore.setState({
      codeFontFamily: "D2Coding",
      fontFamily: "Noto Sans KR",
    });
    const { result } = renderHook(() => useCaptureEditor(true));
    const dom = surfaceOf(result.current.editor);
    expect(dom.style.getPropertyValue("--font-family-editor")).toContain(
      '"Noto Sans KR"',
    );
    expect(dom.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
  });

  // 캡처 창은 열려 있는 동안에도 설정 변경을 따라야 한다 — 마운트 때 한 번만
  // 읽으면 설정 창과 캡처 창이 동시에 열린 흔한 경우에 갈라진다.
  it("follows a later change of either slot", () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    const dom = surfaceOf(result.current.editor);
    expect(dom.style.getPropertyValue("--font-family-mono")).toBe("");
    act(() => {
      useSettingsStore.setState({ codeFontFamily: "D2Coding" });
    });
    expect(dom.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
  });
});
