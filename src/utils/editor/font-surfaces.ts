// §349 문서 표면 — 사용자 서체가 닿는 곳의 열거와 적용.
//
// 왜 :root 가 아닌가: `var(--font-family-mono)` 소비자가 문서보다 앱 크롬에 더
// 많다. 루트에 덮으면 코드 서체를 바꿀 때 파일 트리 경로·git 해시·상태바까지
// 함께 변한다. 표면에만 덮으면 CSS 변수 상속으로 그 표면 **안의** 소비자가
// 따라온다.
//
// ‼️ "상속으로 따라온다"의 범위는 DOM 포함관계이고, 그것은 **파일 경로와 다르다**
// (리뷰 Important 1). `src/styles/editor/**` 에 있는 선언 중 8개는 `.tiptap` 밖에
// 있다 — 전체화면 mermaid·SVG·이미지 오버레이는 `createPortal(…, document.body)`,
// 수식 미리보기 팝오버는 `document.body.appendChild` 로 그려진다. 그것들이 아래
// 열거에 오버레이 표면으로 따로 들어 있는 이유이고, 배선 없이 따라오지 **않는다**.
// 반대 방향도 있다: `.mode-toggle-btn` 은 `styles/editor/base.css` 에 있지만
// App.tsx 툴바의 크롬이라 일부러 토큰 값을 유지한다.
// 그 분류를 `styles/__tests__/font-surface-containment.test.ts` 가 강제한다 —
// 분류되지 않은 선택자가 생기면 실패한다.
//
// 같은 훅이 이미 같은 관용구를 쓴다 — use-settings-effects.ts 의
// `--editor-line-height`. 새 패턴이 아니다.

import { bundledFamily } from "../font/bundled-fonts";
import { quoteFamily } from "./quote-font-family";

export interface FontSurface {
  /** 표면 식별자 — 테스트의 소진 검증이 이 값을 센다. */
  id: string;
  /** 표면 루트 요소의 CSS 선택자. 배선 테스트가 이 값으로 요소를 찾는다. */
  root: string;
  /**
   * 사람이 읽는 위치 설명. 배선이 어디 있는지 찾는 단서.
   *
   * ‼️ 파일 이름까지만 적는다 — 줄 번호는 적지 않는다. 이 저장소에서 그 값은
   * 유지되지 않는 것으로 실증됐다(§349 리뷰: 주석에 적힌 위치 네 개 중 네 개가
   * 틀려 있었다). 파일 이름은 grep 으로 확인되고 편집을 견디지만, 줄 번호를
   * 지키는 가드는 없고 커밋마다 밀린다.
   */
  where: string;
  which: FontSurfaceScope;
}

/** 어떤 변수를 덮는가. `mono` 는 원문을 고정폭으로 보여주는 표면용. */
export type FontSurfaceScope = "both" | "mono";

/**
 * 번들 서체를 머리에 둔 폴백 스택.
 *
 * 토큰(`--font-family-editor`)을 var() 로 참조하지 않고 문자열로 복제하는
 * 이유: 이 값은 그 토큰 **자체를** 덮는 선언의 꼬리로 들어간다. 자기 자신을
 * var() 로 참조하면 순환이 되어 무효해진다. 대신 생성된 토큰과 어긋나지
 * 않는지는 `__tests__/font-surfaces.test.ts` 가 파생 비교로 지킨다.
 */
export const BASE_EDITOR_STACK = `${bundledFamily("body")}, Pretendard, -apple-system, system-ui, sans-serif`;

export const BASE_MONO_STACK = `${bundledFamily("code")}, "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace`;

/**
 * 사용자 서체가 닿아야 하는 표면 전체 — 배선된 것과, 아직 아닌 것.
 *
 * ‼️ 여기에 표면을 더하면 `__tests__/font-surfaces.test.ts` 의 소진 테스트가
 * 실패한다. 그것이 의도다 — 빠뜨린 표면은 조용히 안 바뀌고, 조용한 실패는
 * 사용자가 "왜 여기만 안 변하지"로 발견하게 된다.
 *
 * ‼️ 이 목록은 "닿는다"의 **선언**이고 배선의 증거가 아니다. `where` 가 배선
 * 위치를 말하며, 아직 없는 것은 그렇게 적혀 있다.
 */
export const DOCUMENT_FONT_SURFACES: readonly FontSurface[] = [
  {
    id: "wysiwyg",
    root: ".tiptap",
    where: "editor.view.dom — use-settings-effects.ts",
    which: "both",
  },
  {
    id: "capture-editor",
    root: ".quick-capture-editor .tiptap",
    where: "capture editor.view.dom — use-capture-editor.ts",
    which: "both",
  },
  {
    id: "source-mode",
    root: ".source-code-editor",
    where: "CodeMirror parent div — SourceCodeEditor.tsx",
    which: "mono",
  },
  // 아래 네 개는 `.tiptap` 밖으로 그려지는 오버레이다 (리뷰 Important 1).
  // 문서 블록의 전체화면 쌍둥이이므로 `which` 는 문서와 같은 "both" 다 — 지금
  // 그 CSS 가 mono 만 읽는다는 사실이 아니라 표면의 역할을 적는다.
  {
    id: "mermaid-fullscreen",
    root: ".mermaid-fullscreen-overlay",
    where: "both portals — MermaidFullscreenModals.tsx",
    which: "both",
  },
  {
    id: "svg-fullscreen",
    root: ".svg-fullscreen-overlay",
    where: "both fullscreen portals — views/SvgFullscreenModals.tsx",
    which: "both",
  },
  {
    id: "image-fullscreen",
    root: ".image-fullscreen-overlay",
    where: "portal root — ImageOriginalView.tsx",
    which: "both",
  },
  {
    id: "math-preview-popover",
    root: ".math-inline-preview-popover",
    where: "plugin-view overlay — extensions/plugins/math-inline-edit.ts",
    which: "both",
  },
  {
    id: "export-article",
    root: "article.baram-export",
    where: "inline style attribute — generateStandaloneHTML in export-html.ts",
    which: "both",
  },
] as const;

interface ApplyOptions {
  bodyFont: string;
  codeFont: string;
  which: FontSurfaceScope;
}

/**
 * 표면 루트에 폰트 변수를 설정한다.
 *
 * 빈 설정은 `removeProperty` 다. (`setProperty(prop, "")` 도 CSSOM 에서 같은
 * 결과를 내지만 — 빈 값이면 알고리즘이 removeProperty 를 부른다 — 지우려는
 * 의도를 그대로 적은 쪽이 읽기 쉽다.)
 *
 * ‼️ `:root` 와 `<body>` 는 거부한다. 이 함수는 `HTMLElement` 를 받으므로
 * `applyFontVariables(document.documentElement, …)` 한 줄이면 크롬 전체가
 * 사용자의 코드 서체로 다시 그려진다 — 이 설계가 피하려던 바로 그 누수이고,
 * 스타일이 안 먹는 표면을 발견한 사람이 가장 먼저 시도하는 한 줄이다. 소스
 * grep 가드는 철자만 보므로 이 경로를 못 본다(리뷰 Important 2). 여기서 막으면
 * 아직 쓰이지 않은 호출부까지 덮는다.
 */
export function applyFontVariables(el: HTMLElement, opts: ApplyOptions): void {
  if (el === document.documentElement || el === document.body) {
    throw new Error(
      "§349: font variables must be scoped to a document surface, not " +
        "<html>/<body> — app chrome inherits from there. Add the surface to " +
        "DOCUMENT_FONT_SURFACES and apply it to that element instead.",
    );
  }
  const set = (prop: string, family: string, stack: string) => {
    const quoted = quoteFamily(family);
    if (quoted === "") el.style.removeProperty(prop);
    else el.style.setProperty(prop, `${quoted}, ${stack}`);
  };
  if (opts.which === "both") {
    set("--font-family-editor", opts.bodyFont, BASE_EDITOR_STACK);
  }
  set("--font-family-mono", opts.codeFont, BASE_MONO_STACK);
}
