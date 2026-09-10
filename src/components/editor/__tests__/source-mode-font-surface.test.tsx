// §349 소스 모드 표면 — 코드 서체만 받는다.
//
// `.cm-content` 가 `var(--font-family-mono)` 를 읽으므로(이 컴포넌트의
// `EditorView.theme`), 변수를 CodeMirror 를 담는 래퍼에 두면 상속으로 닿는다.
// 본문 서체는 **덮지 않는다**: 소스 모드는 원문 마크다운을 고정폭으로 보여주는
// 표면이고, 거기에 본문 서체가 들어가면 들여쓰기와 표가 어긋난다.
//
// ‼️ 여기의 단정은 커스텀 속성의 문자열 값이다. jsdom 은 var() 치환을 하지
// 않으므로 CodeMirror 가 그 서체로 그려진다는 증거는 아니다.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { SourceCodeEditor } from "../SourceCodeEditor";

/** CodeMirror의 하이라이트 스타일이 마운트 때 prefers-color-scheme을 묻는다. */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener() {},
      matches: false,
      removeEventListener() {},
    }),
    writable: true,
  });
  useSettingsStore.setState({ codeFontFamily: "", fontFamily: "" });
});

function renderSource() {
  const { container } = render(
    <SourceCodeEditor
      content="# hi"
      getLatestContent={() => "# hi"}
      onChange={() => undefined}
    />,
  );
  const wrapper = container.querySelector(".source-code-editor");
  if (!wrapper) throw new Error(".source-code-editor wrapper not found");
  return wrapper as HTMLElement;
}

describe("§349 source mode font surface", () => {
  it("sets the mono variable on the CodeMirror wrapper", () => {
    useSettingsStore.setState({ codeFontFamily: "D2Coding" });
    const wrapper = renderSource();
    expect(wrapper.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
  });

  // 이 단정이 `which: "mono"` 를 고정한다. `"both"` 로 바뀌면 실패한다.
  it("never sets the body variable — raw markdown stays monospaced", () => {
    useSettingsStore.setState({
      codeFontFamily: "D2Coding",
      fontFamily: "Noto Sans KR",
    });
    const wrapper = renderSource();
    expect(wrapper.style.getPropertyValue("--font-family-editor")).toBe("");
  });

  // 변수는 **래퍼**에 있어야 한다 — CodeMirror 가 만드는 `.cm-content` 는 이
  // 컴포넌트가 소유하지 않으므로 거기에 직접 쓰면 다음 재구성에 사라진다.
  it("puts the variable on an ancestor of .cm-content so it inherits", () => {
    useSettingsStore.setState({ codeFontFamily: "D2Coding" });
    const wrapper = renderSource();
    const content = wrapper.querySelector(".cm-content");
    expect(content).not.toBeNull();
    expect(wrapper.contains(content)).toBe(true);
  });

  // ‼️ 이 컴포넌트는 다른 설정을 전부 `getState()` 로 읽는다 — 코드 서체만
  // 반응형 셀렉터를 새로 달았으므로, 그 리렌더가 CodeMirror 를 다시 만들지
  // 않는다는 것을 고정한다. 다시 만들면 커서·실행 취소 스택·스크롤이 날아간다.
  it("keeps the same CodeMirror instance across a code-font change", () => {
    const wrapper = renderSource();
    const before = wrapper.querySelector(".cm-editor");
    expect(before).not.toBeNull();
    act(() => {
      useSettingsStore.setState({ codeFontFamily: "D2Coding" });
    });
    // 먼저 리렌더가 실제로 일어났음을 보인다 — 안 일어났다면 아래 "그대로다"는
    // 아무것도 증명하지 않는다.
    expect(wrapper.style.getPropertyValue("--font-family-mono")).toContain(
      '"D2Coding"',
    );
    expect(before!.isConnected).toBe(true);
    expect(wrapper.querySelector(".cm-editor")).toBe(before);
  });
});
