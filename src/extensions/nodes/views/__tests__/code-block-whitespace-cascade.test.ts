// issue 468 — vim normal 모드에서 코드블록 들여쓰기가 표시에서 사라지던
// 결함의 캐스케이드 핀.
//
// tiptap core는 `.ProseMirror [contenteditable="false"] { white-space:
// normal }`을 주입하고, vim normal 모드는 IME 차단(3v)을 위해 island의
// editing host를 제거한다 — cm-content가 contenteditable="false"가 되는
// 순간 그 규칙에 직접 매치되어 선행 공백이 표시에서 붕괴했다 (기기 실측:
// computed white-space가 모드 따라 normal↔pre-wrap 플립).
//
// 이 스위트는 손으로 베낀 규칙이 아니라 **실제 캐스케이드**를 시험한다
// (적대 리뷰): 실제 Editor 생성이 주입하는 tiptap 스타일 태그(전제 테스트가
// 규칙의 실재를 고정 — 업그레이드로 selector/값이 바뀌면 여기서 먼저
// 실패한다), 실제 extensions로 마운트된 CM island(cm-lineWrapping 포함),
// 그리고 code-blocks.css 원문. contenteditable 플립만 합성이다(3v가
// production에서 하는 일 그대로). CONTROL 두 개가 결함 재현과 카운터 규칙
// 단독 제거를 각각 고정한다.
//
// 주입 순서 주의: production은 앱 CSS(번들)가 먼저, tiptap 태그가 Editor
// 생성 시 나중이다. 파일 첫 테스트 이후엔 tiptap 태그가 문서에 남아
// 이후 테스트의 앱 CSS가 그보다 뒤에 놓이지만, 카운터 규칙의 값이 tiptap
// 규칙 2와 같은 pre-wrap이라 (0,3,0) 동률의 승자와 무관하게 결과가 같다 —
// 그 값 일치가 수정의 설계 요점이고, 검증은 전부 값으로 한다.

import { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../index";

if (typeof window.matchMedia !== "function") {
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const zeroRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
};
Range.prototype.getBoundingClientRect ??= () => zeroRect as DOMRect;
Range.prototype.getClientRects ??= () =>
  ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
HTMLElement.prototype.getClientRects ??= Range.prototype.getClientRects;

// vitest cwd = repo 루트 (import.meta.url은 jsdom 환경에서 file 스킴이 아님).
const APP_CSS = readFileSync("src/styles/editor/code-blocks.css", "utf8");
const COUNTER_RULE_RE = /\.tiptap \.code-block-editor \.cm-content \{[^}]*\}/;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function injectStyle(css: string): void {
  const style = document.createElement("style");
  style.setAttribute("data-test-style", "");
  style.textContent = css;
  document.head.appendChild(style);
  cleanups.push(() => style.remove());
}

/** 실제 Editor + 실제 CM island를 마운트하고 cm-content를 돌려준다.
 *  contenteditable만 합성으로 플립한다 (3v의 production 동작). */
async function mountIsland(
  contentEditable: "false" | "true",
): Promise<HTMLElement> {
  const editor = new Editor({
    content: "",
    extensions: createBaramExtensions(),
  });
  cleanups.push(() => editor.destroy());
  const doc = markdownToProsemirror(
    "```py\n    indented()\n```\n",
    editor.schema,
  );
  editor.commands.setContent(doc.toJSON());
  // destroy() 이후 editor.view getter는 throw한다 — cleanup용 참조는 지금 캡처.
  const dom = editor.view.dom;
  document.body.appendChild(dom);
  cleanups.push(() => dom.remove());
  for (const io of MockIntersectionObserver.instances) {
    io.triggerIntersect(true);
  }
  await vi.waitFor(() => {
    expect(dom.querySelector(".cm-content")).not.toBeNull();
  });
  const content = dom.querySelector(".cm-content") as HTMLElement;
  content.setAttribute("contenteditable", contentEditable);
  neutralizeCmSheets();
  return content;
}

/** CM(style-mod) 시트 중립화 — jsdom과 실브라우저의 캐스케이드 순서가
 *  다르기 때문이다. 실브라우저에서 style-mod는 시트를 head 최상단에 꽂아
 *  동률에서 항상 진다(기기 실측: normal 모드 computed=normal, 즉 tiptap
 *  승). jsdom은 adoptedStyleSheets를 문서 시트 **뒤**로 캐스케이드해
 *  CM의 break-spaces가 모든 걸 이겨버려 결함 재현 자체가 안 된다. 이
 *  스위트의 대상은 tiptap 주입 규칙 vs 카운터 규칙이므로, 기기에서
 *  검증된 그 대결 구도만 남긴다. */
function neutralizeCmSheets(): void {
  document.adoptedStyleSheets = [];
  for (const s of Array.from(document.querySelectorAll("style"))) {
    if (s.hasAttribute("data-test-style")) continue;
    if ((s.textContent ?? "").includes(".cm-lineWrapping")) s.remove();
  }
}

describe("code block whitespace cascade (issue 468)", () => {
  it("전제+CONTROL: 실제 tiptap 주입 규칙이 존재하고, 카운터 규칙 없이는 normal-mode가 붕괴한다", async () => {
    const content = await mountIsland("false");
    // 전제 — Editor 생성이 주입한 REAL 스타일에 문제의 규칙이 실재한다.
    // tiptap 업그레이드가 selector/값을 바꾸면 여기가 먼저 무너진다.
    const injected = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(injected).toMatch(
      /\.ProseMirror \[contenteditable="false"\]\s*\{\s*white-space:\s*normal/,
    );
    // CONTROL — 앱 CSS가 없으니 결함이 재현된다.
    expect(getComputedStyle(content).whiteSpace).toBe("normal");
  });

  it("CONTROL: 카운터 규칙만 제거한 앱 CSS로도 여전히 붕괴한다 (규칙 단독 효과 고정)", async () => {
    expect(APP_CSS).toMatch(COUNTER_RULE_RE); // 규칙이 파일에 실재
    injectStyle(APP_CSS.replace(COUNTER_RULE_RE, ""));
    const content = await mountIsland("false");
    expect(getComputedStyle(content).whiteSpace).toBe("normal");
  });

  it("fix: vim normal(ce=false)에서 정확히 pre-wrap", async () => {
    injectStyle(APP_CSS);
    const content = await mountIsland("false");
    expect(getComputedStyle(content).whiteSpace).toBe("pre-wrap");
  });

  it("fix: insert(ce=true)에서도 정확히 pre-wrap — 양 모드 동일", async () => {
    injectStyle(APP_CSS);
    const content = await mountIsland("true");
    expect(getComputedStyle(content).whiteSpace).toBe("pre-wrap");
  });
});
