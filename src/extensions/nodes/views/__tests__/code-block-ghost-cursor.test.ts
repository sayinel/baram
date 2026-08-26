// issue 473 — 코드블록을 떠난 뒤 CM vim의 fat cursor가 hollow 잔상으로,
// visual 선택 하이라이트(selectionLayer)가 파란 잔상으로 남던 결함의
// 캐스케이드 핀.
//
// codemirror-vim baseTheme: `&:not(.cm-focused) .cm-fat-cursor {
// background: none; outline: solid 1px #ff9696; ... }` — 실제 vim의
// 비활성 창 관례다. source mode(화면 전체가 하나의 CM)에는 자연스럽지만
// WYSIWYG 안의 island는 비활성 창이 아니므로, 포커스를 잃은 island의
// 커서 잔상들은 숨겨야 한다. display는 테마가 건드리지 않는 속성이라
// 캐스케이드 충돌 없이 우리 규칙 하나로 결정된다 — 핀도 display로
// 고정한다.
//
// 판정은 `:focus-within`이다 (적대 리뷰): cm-focused는 contentDOM만
// 추적해 island 안의 vim `:`/`/` 패널 포커스를 "떠남"으로 오판한다 —
// 핀은 실제 DOM 포커스로 검증한다.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

// vitest cwd = repo 루트.
const APP_CSS = readFileSync("src/styles/editor/code-blocks.css", "utf8");
const HIDE_RULE_RE =
  /\.code-block-editor \.cm-editor:not\(:focus-within\) \.cm-fat-cursor,\n\.code-block-editor \.cm-editor:not\(:focus-within\) \.cm-selectionLayer \{[^}]*\}/;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

interface Island {
  cursor: HTMLElement;
  panelInput: HTMLInputElement;
  selection: HTMLElement;
}

/** island 여부를 바꿔가며 fat-cursor·selectionLayer 조각과, island 루트
 *  안(contentDOM 밖 — vim `:`/`/` 패널 위치)의 포커스 대상 input을 만든다. */
function buildIsland(opts: { island: boolean }): Island {
  const root = document.createElement("div");
  const editor = document.createElement("div");
  editor.className = "cm-editor";
  const cursorLayer = document.createElement("div");
  cursorLayer.className = "cm-cursorLayer cm-vimCursorLayer";
  const cursor = document.createElement("div");
  cursor.className = "cm-fat-cursor cm-cursor-primary";
  cursorLayer.appendChild(cursor);
  const selection = document.createElement("div");
  selection.className = "cm-selectionLayer";
  const panelInput = document.createElement("input");
  editor.append(cursorLayer, selection, panelInput);
  if (opts.island) {
    const container = document.createElement("div");
    container.className = "code-block-editor";
    container.appendChild(editor);
    root.appendChild(container);
  } else {
    root.appendChild(editor); // source mode: island 컨테이너 없음
  }
  document.body.appendChild(root);
  cleanups.push(() => root.remove());
  return { cursor, panelInput, selection };
}

describe("code block ghost artifacts (issue 473)", () => {
  it("drift alarm: installed codemirror-vim still ships the unfocused hollow rule", () => {
    // 업그레이드로 이 테마가 바뀌면 우리 대응책의 전제부터 다시 봐야 한다.
    const vimSrc = readFileSync(
      "node_modules/@replit/codemirror-vim/dist/index.js",
      "utf8",
    );
    expect(vimSrc).toMatch(/&:not\(\.cm-focused\) \.cm-fat-cursor"?\s*:\s*\{/);
  });

  it("unfocused island: fat cursor AND selection layer are hidden", () => {
    injectStyle(APP_CSS);
    const island = buildIsland({ island: true });
    expect(document.activeElement).not.toBe(island.panelInput);
    expect(getComputedStyle(island.cursor).display).toBe("none");
    expect(getComputedStyle(island.selection).display).toBe("none");
  });

  it("focus INSIDE the island root (panel focus counts): artifacts stay visible", () => {
    // vim `:`/`/` 패널은 contentDOM 밖·island 루트 안이다 — cm-focused는
    // 이 상태를 놓치지만 :focus-within은 island 소유로 판정한다.
    injectStyle(APP_CSS);
    const island = buildIsland({ island: true });
    island.panelInput.focus();
    expect(document.activeElement).toBe(island.panelInput);
    expect(getComputedStyle(island.cursor).display).not.toBe("none");
    expect(getComputedStyle(island.selection).display).not.toBe("none");
  });

  it("source mode (no island container): untouched", () => {
    injectStyle(APP_CSS);
    const island = buildIsland({ island: false });
    expect(getComputedStyle(island.cursor).display).not.toBe("none");
    expect(getComputedStyle(island.selection).display).not.toBe("none");
  });

  it("CONTROL: without the hide rule the ghost artifacts would render", () => {
    expect(APP_CSS).toMatch(HIDE_RULE_RE); // 규칙이 파일에 실재
    injectStyle(APP_CSS.replace(HIDE_RULE_RE, ""));
    const island = buildIsland({ island: true });
    expect(getComputedStyle(island.cursor).display).not.toBe("none");
    expect(getComputedStyle(island.selection).display).not.toBe("none");
  });
});

function injectStyle(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  cleanups.push(() => style.remove());
}
