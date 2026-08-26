// issue 473 동계열 — 잔상 커서 전수 진단의 표면 2: 포커스가 앱 크롬
// (사이드바·검색·패널)에 있는 동안 PM 본문의 vim 블록 커서가 solid로
// 남아 "여기에 타이핑된다"는 오신호를 냈다. vim의 비활성 창 관례대로
// hollow로 전환하는 규칙의 캐스케이드 핀 (display가 아니라 outline/
// background 전환이므로 실제 포커스로 검증한다).

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

// vitest cwd = repo 루트.
const VIM_CSS = readFileSync("src/styles/vim.css", "utf8");
const HOLLOW_RULE_RE =
  /\.tiptap\.vim-modal:not\(:focus-within\) \.vim-cursor \{[^}]*\}/;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

interface Surface {
  cursor: HTMLElement;
  editorInput: HTMLInputElement;
  eol: HTMLElement;
}

/** vim-modal PM 표면 형상: .tiptap.ProseMirror.vim-modal 아래 블록 커서
 *  decoration과 EOL caret, 그리고 포커스 대상(실제로는 루트의 tabindex,
 *  jsdom에서는 focusable input으로 대신). */
function buildSurface(): Surface {
  const root = document.createElement("div");
  const surface = document.createElement("div");
  surface.className = "tiptap ProseMirror vim-modal";
  const cursor = document.createElement("span");
  cursor.className = "vim-cursor";
  cursor.textContent = "t";
  const eol = document.createElement("span");
  eol.className = "vim-cursor-eol";
  const editorInput = document.createElement("input");
  surface.append(cursor, eol, editorInput);
  root.appendChild(surface);
  document.body.appendChild(root);
  cleanups.push(() => root.remove());
  return { cursor, editorInput, eol };
}

function injectStyle(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  cleanups.push(() => style.remove());
}

describe("PM vim cursor goes hollow when the surface loses focus (issue 473 sweep)", () => {
  it("unfocused surface: block cursor is hollow, EOL caret dimmed", () => {
    injectStyle(VIM_CSS);
    const s = buildSurface();
    expect(document.activeElement).not.toBe(s.editorInput);
    const cs = getComputedStyle(s.cursor);
    expect(cs.outlineOffset).toBe("-1px");
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(cs.backgroundColor);
    expect(getComputedStyle(s.eol).opacity).toBe("0.45");
  });

  it("focused surface: block cursor stays solid", () => {
    injectStyle(VIM_CSS);
    const s = buildSurface();
    s.editorInput.focus();
    expect(document.activeElement).toBe(s.editorInput);
    const cs = getComputedStyle(s.cursor);
    expect(cs.outlineOffset).not.toBe("-1px");
    expect(getComputedStyle(s.eol).opacity).not.toBe("0.45");
  });

  it("CONTROL: without the hollow rule the unfocused cursor would stay solid", () => {
    expect(VIM_CSS).toMatch(HOLLOW_RULE_RE); // 규칙이 파일에 실재
    injectStyle(VIM_CSS.replace(HOLLOW_RULE_RE, ""));
    const s = buildSurface();
    expect(getComputedStyle(s.cursor).outlineOffset).not.toBe("-1px");
  });
});
