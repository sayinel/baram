// §349 — 훅이 인라인 font-family 가 아니라 변수 두 개를 설정하는지.
//
// 기존 구현(§346 결함 6)은 `.tiptap` 요소에 인라인 font-family 를 걸었고,
// 코드·수식·표가 쓰는 var(--font-family-mono) 30곳에는 닿지 않았다. 그래서
// "코드 서체" 라는 설정이 존재할 수 없었다.
//
// ‼️ 여기의 단정은 커스텀 속성의 **문자열 값**이다. jsdom 은 var() 치환을
// 구현하지 않으므로 "그 서체로 렌더된다"는 이 파일이 증명할 수 없다.
import type { Editor } from "@tiptap/core";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useSettingsEffects } from "../use-settings-effects";

// 훅의 세 네이티브 메뉴 이펙트는 지연 import 를 쓴다 — 목이 없으면 vitest 가
// 환경을 내린 뒤에 착지해 모든 테스트가 통과한 채로 런이 실패한다
// (`use-settings-effects-menu-sync.test.tsx` 와 같은 이유·같은 목).
const mocks = vi.hoisted(() => ({
  syncMenuEnabled: vi.fn(() => Promise.resolve()),
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../ipc/menu-locale", () => ({
  syncMenuLocale: mocks.syncMenuLocale,
}));
vi.mock("../../ipc/recent-menu", () => ({
  syncRecentMenu: mocks.syncRecentMenu,
}));
vi.mock("../../ipc/menu-enabled", () => ({
  syncMenuEnabled: mocks.syncMenuEnabled,
}));

/**
 * 훅이 편집기에서 읽는 것 전부 — `view.dom` 하나가 아니다.
 *
 * spellcheck 이펙트가 `editor.setOptions`·`editor.options.editorProps` 를
 * 만지므로 그 둘이 빠지면 폰트와 무관한 TypeError 로 죽는다. 훅의 시그니처는
 * `useSettingsEffects(editor: Editor | null)` 이고, 테스트를 통과시키려고
 * 그것을 바꾸지 않는다 — 대신 double 이 그 계약을 맞춘다.
 */
function fakeEditor(el: HTMLElement): Editor {
  return {
    options: { editorProps: {} },
    setOptions: () => undefined,
    view: { dom: el },
  } as unknown as Editor;
}

describe("§349 use-settings-effects font wiring", () => {
  let surface: HTMLElement;
  /** ‼️ 안정된 참조다. 렌더마다 새 double 을 만들면 `editor` 가 deps 에 있어
   *  이펙트가 무조건 재실행되고, 폰트 키가 deps 에 있는지를 못 본다. */
  let editor: Editor;

  beforeEach(() => {
    surface = document.createElement("div");
    surface.className = "tiptap";
    document.body.append(surface);
    editor = fakeEditor(surface);
    useSettingsStore.setState({
      codeFontFamily: "",
      codeFontSize: 14,
      codeLineHeight: 1.75,
      fontFamily: "",
      fontSize: 16,
      lineHeight: 1.75,
      linkFontMetrics: true,
    });
  });

  afterEach(() => {
    surface.remove();
  });

  it("sets both font variables on the active editor surface", () => {
    useSettingsStore.setState({
      codeFontFamily: "D2Coding",
      fontFamily: "Noto Sans KR",
    });
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.getPropertyValue("--font-family-editor")).toContain(
      '"Noto Sans KR"',
    );
    expect(surface.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
  });

  // 결함 6의 회귀 가드: 인라인 font-family 로 돌아가면 실패한다.
  it("does not set an inline font-family on the surface", () => {
    useSettingsStore.setState({ fontFamily: "Noto Sans KR" });
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.fontFamily).toBe("");
  });

  it("clears the variables when the settings go back to empty", () => {
    useSettingsStore.setState({
      codeFontFamily: "D2Coding",
      fontFamily: "Inter",
    });
    renderHook(() => useSettingsEffects(editor));
    act(() => {
      useSettingsStore.setState({ codeFontFamily: "", fontFamily: "" });
    });
    expect(surface.style.getPropertyValue("--font-family-editor")).toBe("");
    expect(surface.style.getPropertyValue("--font-family-mono")).toBe("");
  });

  // 코드 슬롯 **하나만** 바꾼다. `codeFontFamily` 가 이펙트의 deps 에서 빠지면
  // 여기서만 실패한다 — 위 테스트들은 본문 슬롯과 함께 바꾸므로 통과한다.
  it("re-applies when only the code slot changes", () => {
    renderHook(() => useSettingsEffects(editor));
    act(() => {
      useSettingsStore.setState({ codeFontFamily: "D2Coding" });
    });
    expect(surface.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
    expect(surface.style.getPropertyValue("--font-family-editor")).toBe("");
  });
});

// §354 크기·줄 높이도 같은 표면에 변수로 건다. 서체와 같은 이유다: 인라인
// 스타일은 이 요소 하나만 덮지만, 코드는 문서 안 여러 자리에서 제 크기를
// 선언한다(인라인 코드 · 코드블록 편집기 · 그 플레이스홀더).
//
// ‼️ 여기서도 단정은 커스텀 속성의 **문자열 값**이다 — jsdom 은 var() 치환도
// em 계산도 하지 않으므로 "그 크기로 렌더된다"는 이 파일이 증명할 수 없다.
describe("§354 use-settings-effects code metrics", () => {
  let surface: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    surface = document.createElement("div");
    surface.className = "tiptap";
    document.body.append(surface);
    editor = fakeEditor(surface);
    useSettingsStore.setState({
      codeFontSize: 14,
      codeLineHeight: 1.75,
      fontSize: 16,
      lineHeight: 1.75,
      linkFontMetrics: true,
    });
  });

  afterEach(() => {
    surface.remove();
  });

  it("derives the code variables from the body while linked", () => {
    useSettingsStore.setState({ fontSize: 20, lineHeight: 2 });
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.getPropertyValue("--editor-code-font-size")).toBe(
      "17.5px",
    );
    expect(surface.style.getPropertyValue("--editor-code-line-height")).toBe(
      "2",
    );
  });

  it("uses the code values once unlinked", () => {
    useSettingsStore.setState({
      codeFontSize: 11,
      codeLineHeight: 1.3,
      fontSize: 20,
      lineHeight: 2,
      linkFontMetrics: false,
    });
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.getPropertyValue("--editor-code-font-size")).toBe(
      "11px",
    );
    expect(surface.style.getPropertyValue("--editor-code-line-height")).toBe(
      "1.3",
    );
  });

  // deps 가드 — 연동 스위치**만** 뒤집는다. `linkFontMetrics` 가 이펙트의
  // deps 에서 빠지면 여기서만 실패한다: 위 두 테스트는 크기도 함께 바꾸므로
  // 통과한다.
  it("re-applies when only the link switch changes", () => {
    useSettingsStore.setState({ codeFontSize: 9, codeLineHeight: 1.1 });
    renderHook(() => useSettingsEffects(editor));
    act(() => {
      useSettingsStore.setState({ linkFontMetrics: false });
    });
    expect(surface.style.getPropertyValue("--editor-code-font-size")).toBe(
      "9px",
    );
  });
});
