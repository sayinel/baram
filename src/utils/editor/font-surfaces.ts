// §349 문서 표면 — 사용자 서체가 닿는 곳의 열거와 적용.
//
// 왜 :root 가 아닌가 (2026-09-10 실측, 주석 제거 후): var(--font-family-mono)
// 선언이 문서 쪽 src/styles/editor/** 에 30개, 그 밖의 스타일시트에 61개 있다.
// 루트에 덮으면 코드 서체를 바꿀 때 파일 트리 경로·git 해시·상태바까지 함께
// 변한다. 표면에만 덮으면 CSS 변수 상속으로 문서 쪽 30곳이 배선 추가 없이
// 따라온다. 그 비대칭(크롬 > 문서)은 `styles/__tests__/font-variable-scope.test.ts`
// 가 계속 지킨다 — 위 두 숫자는 그 시점의 측정값이므로 정확한 값은 그 파일에서
// 다시 세는 것이 맞다.
//
// 같은 훅이 이미 같은 관용구를 쓴다 — use-settings-effects.ts 의
// `--editor-line-height`. 새 패턴이 아니다.

import type { BundledFont } from "../font/bundled-fonts";

import { BUNDLED_FONTS } from "../font/bundled-fonts";
import { quoteFamily } from "./quote-font-family";

export interface FontSurface {
  /** 표면 식별자 — 테스트의 소진 검증이 이 값을 센다. */
  id: string;
  /** 사람이 읽는 위치 설명. 배선이 어디 있는지 찾는 단서. */
  where: string;
  which: FontSurfaceScope;
}

/** 어떤 변수를 덮는가. `mono` 는 원문을 고정폭으로 보여주는 표면용. */
export type FontSurfaceScope = "both" | "mono";

/**
 * 번들 서체의 CSS 표기 — 이름은 `bundled-fonts.ts` 하나에만 적혀 있다 (§347).
 *
 * 없는 역할을 물으면 던진다. 이름 없는 폴백 스택은 조용히 시스템 서체로
 * 렌더되어 §346 의 결함("이름만 있고 실물이 없다")을 반대 방향으로 되살린다 —
 * import 시점의 큰 소리가 낫다.
 */
function bundledFamily(role: BundledFont["role"]): string {
  const font = BUNDLED_FONTS.find((f) => f.role === role);
  if (!font) throw new Error(`§347: no bundled font for the "${role}" role`);
  return quoteFamily(font.family);
}

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
 * 사용자 서체가 닿는 표면 전체.
 *
 * ‼️ 여기에 표면을 더하면 `__tests__/font-surfaces.test.ts` 의 소진 테스트가
 * 실패한다. 그것이 의도다 — 빠뜨린 표면은 조용히 안 바뀌고, 조용한 실패는
 * 사용자가 "왜 여기만 안 변하지"로 발견하게 된다.
 */
export const DOCUMENT_FONT_SURFACES: readonly FontSurface[] = [
  {
    id: "wysiwyg",
    where: "editor.view.dom (.tiptap) — use-settings-effects.ts",
    which: "both",
  },
  {
    id: "capture-editor",
    where: ".quick-capture-editor .tiptap — use-capture-editor.ts",
    which: "both",
  },
  {
    id: "source-mode",
    where: "div.source-code-editor (CodeMirror parent) — SourceCodeEditor.tsx",
    which: "mono",
  },
  {
    id: "export-article",
    where: "article.baram-export — export-html.ts",
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
 * 빈 설정은 `removeProperty` 다 — 빈 문자열을 넣으면 계산 시점에 무효가 되어
 * 상속값을 받게 되고, 그러면 "토큰 스택을 그대로 쓴다"가 아니라 "부모에서
 * 받는다"가 된다. 그 둘은 문서 표면 밖에서 다르다.
 */
export function applyFontVariables(el: HTMLElement, opts: ApplyOptions): void {
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
