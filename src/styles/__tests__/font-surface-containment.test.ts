// §349 리뷰 Important 1 — 파일 경로는 DOM 포함관계가 아니다.
//
// 이 파일이 존재하는 이유가 그 결함 자체다. 원래 가드
// (`font-variable-scope.test.ts`)는 `var(--font-family-mono)` 선언을 **파일
// 경로**로 문서/크롬으로 나눴다: `src/styles/editor/**` 는 문서, 나머지는 크롬.
// 그 분류는 양쪽으로 틀렸다.
//
//   · `.mermaid-fullscreen-editor .mermaid-block-textarea` 등 8개 선언은
//     `styles/editor/**` 에 있지만 `createPortal(…, document.body)` 나
//     `document.body.appendChild` 로 `.tiptap` **밖에** 그려진다. 표면에만 변수를
//     덮는 설계에서 이들은 아무것도 상속받지 못한다 — 사용자가 코드 서체를
//     바꾸면 인라인 mermaid textarea 는 변하고 그 전체화면 쌍둥이는 안 변한다.
//   · `.mode-toggle-btn` 은 반대다: `styles/editor/base.css` 에 있지만 App.tsx
//     툴바가 그리는 크롬이라 **변해서는 안 된다**.
//
// 그래서 이 가드는 선택자마다 "누가 이것을 덮는가"를 사람이 분류하게 만들고,
// 분류되지 않은 선택자가 하나라도 생기면 실패한다. 새 오버레이를 만들면서
// 표면 배선을 잊는 것이 곧 빨간불이다 — 그것이 원래 결함의 발생 경로였다.
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DOCUMENT_FONT_SURFACES } from "../../utils/editor/font-surfaces";
import { cssRules, selectorParts } from "./css-rules";

/** `.tiptap` 하위 NodeView 가 그린다 — 문서 표면의 상속을 그대로 받는다. */
const INSIDE_TIPTAP = "inside-tiptap";

/** 편집기 DOM 밖의 앱 크롬. 코드 서체 설정을 따라가지 **않는** 것이 맞다. */
const CHROME = "chrome";

/**
 * `styles/editor/**` 에서 폰트 변수를 읽되 선택자가 `.tiptap` 으로 시작하지 않는
 * 것 전부 → 그것을 덮는 표면 `id`, 또는 위 두 sentinel.
 *
 * ‼️ 여기 없는 선택자가 발견되면 이 파일이 실패한다. 그것이 요점이다: 분류를
 * 강제하지 않으면 "파일이 styles/editor/ 에 있으니 문서겠지"로 넘어가고, 그
 * 추측이 정확히 리뷰가 잡은 8개 선언을 만들었다.
 */
const COVERED_BY: Record<string, string> = {
  ".code-block-lang-select": INSIDE_TIPTAP,
  ".code-block-placeholder": INSIDE_TIPTAP,
  ".image-fullscreen-close": "image-fullscreen",
  // ImageOriginalView 의 포털 (`:89` 가 document.body).
  ".image-fullscreen-label": "image-fullscreen",
  // math-inline-edit.ts 의 플러그인 뷰가 `document.body.appendChild` 로 만든다 —
  // React 포털이 아니라서 리뷰의 포털 표에도 없었다.
  ".math-inline-preview-error": "math-preview-popover",
  ".media-resize-label": INSIDE_TIPTAP,
  ".mermaid-fullscreen-close": "mermaid-fullscreen",
  // MermaidFullscreenModals.tsx 의 두 포털 (`:51`, `:125`).
  ".mermaid-fullscreen-editor .mermaid-block-textarea": "mermaid-fullscreen",
  ".mermaid-fullscreen-type": "mermaid-fullscreen",
  // PreviewToggleButton.tsx — App.tsx 툴바. 파일은 styles/editor/ 지만 크롬이다.
  ".mode-toggle-btn": CHROME,
  ".svg-fullscreen-close": "svg-fullscreen",
  // svg-block-view.tsx 의 두 포털 (`:234`, `:287`).
  ".svg-fullscreen-editor .svg-block-textarea": "svg-fullscreen",
};

/** `styles/editor/**` 규칙 중 폰트 변수를 읽는 선택자들 — `.tiptap` 계열 제외. */
function nonTiptapFontSelectors(): string[] {
  const found = new Set<string>();
  const documentDir = `${path.sep}styles${path.sep}editor${path.sep}`;
  for (const rule of cssRules()) {
    if (!rule.file.includes(documentDir)) continue;
    if (!/var\(--font-family-(?:editor|mono)\)/u.test(rule.body)) continue;
    for (const part of selectorParts(rule.selector)) {
      if (part.startsWith(".tiptap")) continue;
      found.add(part);
    }
  }
  return [...found].sort();
}

describe("§349 font surface containment", () => {
  // 소진 산술. 새 선언을 추가하면서 분류를 빠뜨리면 여기서 먼저 실패한다.
  it("classifies every non-.tiptap font-variable selector under styles/editor", () => {
    expect(nonTiptapFontSelectors()).toEqual(Object.keys(COVERED_BY).sort());
  });

  // 분류가 실재하는 표면을 가리켜야 한다 — 오타나 사라진 표면을 무죄로 넘기지 않는다.
  it("names a real surface for every classified selector", () => {
    const ids = new Set(DOCUMENT_FONT_SURFACES.map((s) => s.id));
    for (const [selector, owner] of Object.entries(COVERED_BY)) {
      if (owner === INSIDE_TIPTAP || owner === CHROME) continue;
      expect(ids, `${selector} names an unknown surface "${owner}"`).toContain(
        owner,
      );
    }
  });

  // 오버레이 표면은 자기를 필요로 하는 선택자가 있어야 한다 — 아무도 안 쓰는
  // 표면 항목은 배선이 사라졌다는 신호다.
  it("has at least one classified selector per overlay surface", () => {
    const owners = new Set(Object.values(COVERED_BY));
    for (const id of [
      "image-fullscreen",
      "math-preview-popover",
      "mermaid-fullscreen",
      "svg-fullscreen",
    ]) {
      expect(owners, `surface ${id} covers nothing`).toContain(id);
    }
  });
});
