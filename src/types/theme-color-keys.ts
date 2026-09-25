// §54 테마 색 키 — 생성기와 앱이 함께 읽는 잎 모듈.
//
// `style-dictionary.config.ts`가 기본 팔레트를 생성하려면 25키 목록이 필요하고,
// `theme.ts`는 그 생성물을 import 한다. 키 목록이 `theme.ts`에 있으면 생성기 →
// theme.ts → 생성물 → (아직 없음) 의 순환이 된다. 그래서 키 목록만 여기 있다.
//
// ‼️ 이 파일은 아무것도 import 하지 않는다. 테스트가 그것을 고정한다.

// ---------------------------------------------------------------------------
// 1. ThemeColors — 25 CSS custom property keys
// ---------------------------------------------------------------------------

// 감사 순서 6: 25키를 손으로 두 번 적지 않는다 — 아래 THEME_COLOR_KEYS(값,
// 색 피커 메타데이터)가 단일 출처이고, 이 타입은 그 배열에서 파생된다. 키를
// 추가/삭제하려면 배열 한 곳만 고치면 타입·에디터 UI·clearThemeVars의 제거
// 목록이 함께 따라온다. (배열은 2번 섹션에 있다 — 타입 공간의 typeof 참조는
// 선언 순서를 타지 않는다.)
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number]["key"];
export type ThemeColors = Record<ThemeColorKey, string>;

// CLAUDE.md의 CSS 변수 규약: category는 9개뿐이다. 접두만 검사하면
// --color-foo-bar도 컴파일을 통과하므로 union으로 좁힌다(적대 리뷰).
type ThemeColorKeyName = `--color-${
  | "accent"
  | "bg"
  | "border"
  | "callout"
  | "editor"
  | "git"
  | "graph"
  | "status"
  | "text"}-${string}`;

// ---------------------------------------------------------------------------
// 2. THEME_COLOR_KEYS — metadata for rendering color pickers in ThemeEditor
// ---------------------------------------------------------------------------

export const THEME_COLOR_KEYS = [
  // Background
  {
    key: "--color-bg-default",
    label: "Primary Background",
    category: "Background",
  },
  {
    key: "--color-bg-subtle",
    label: "Secondary Background",
    category: "Background",
  },
  {
    key: "--color-bg-panel",
    label: "Sidebar Background",
    category: "Background",
  },
  {
    key: "--color-bg-elevated",
    label: "Tertiary Background",
    category: "Background",
  },
  {
    key: "--color-bg-input",
    label: "Input Background",
    category: "Background",
  },

  // Text
  { key: "--color-text-primary", label: "Primary Text", category: "Text" },
  { key: "--color-text-secondary", label: "Secondary Text", category: "Text" },
  { key: "--color-text-disabled", label: "Muted Text", category: "Text" },

  // Border
  { key: "--color-border-default", label: "Border", category: "Border" },
  { key: "--color-border-subtle", label: "Light Border", category: "Border" },

  // Accent
  { key: "--color-accent-default", label: "Accent", category: "Accent" },
  { key: "--color-accent-hover", label: "Accent Hover", category: "Accent" },
  { key: "--color-accent-subtle", label: "Accent Subtle", category: "Accent" },
  { key: "--color-accent-ai", label: "AI Accent", category: "Accent" },

  // Editor
  { key: "--color-editor-bg", label: "Editor Background", category: "Editor" },
  { key: "--color-editor-text", label: "Editor Text", category: "Editor" },
  {
    key: "--color-editor-selection",
    label: "Editor Selection",
    category: "Editor",
  },
  { key: "--color-editor-cursor", label: "Editor Cursor", category: "Editor" },
  // §369 중첩 리스트의 들여쓰기 가이드가 섞이는 색. 최종 색이 아니라 **색조**다 —
  // `lists.css` 가 이것을 `--color-editor-bg` 쪽으로 섞고, 섞는 비율은 사용자
  // 다이얼(`editorListGuideStrength`)이 정한다. 두 축이 직교하므로 테마가 색조를
  // 골라도 사용자의 농도 선택이 살아남는다.
  //
  // 이 키가 여기 있어야만 테마가 색조에 닿는다: 테마 패키지의 CSS 는
  // `utils/theme-css/sanitize.ts` 가 `@layer baram-theme` 로 감싸고 그 안의
  // `!important` 를 떼므로(`node.important = false`), 레이어 밖에 있는
  // `styles/generated/semantic-*.css` 의 선언을 이기지 못한다. 이 배열만
  // `applyThemeVars` 의 `<html>` 인라인 경로로 가고, 인라인은 레이어를 이긴다.
  //
  // `aliasOf` 는 이 키가 **팔레트보다 늦게 생겼다**는 표시다 — 아래 4번 절.
  {
    key: "--color-editor-guide-tint",
    label: "List Guide",
    category: "Editor",
    aliasOf: "--color-editor-text",
  },

  // Status
  { key: "--color-status-danger", label: "Danger", category: "Status" },
  { key: "--color-status-warning", label: "Warning", category: "Status" },
  { key: "--color-status-success", label: "Success", category: "Status" },

  // Graph
  { key: "--color-graph-node", label: "Graph Node", category: "Graph" },
  { key: "--color-graph-active", label: "Graph Active", category: "Graph" },
  { key: "--color-graph-edge", label: "Graph Edge", category: "Graph" },
] as const satisfies readonly {
  aliasOf?: ThemeColorKeyName;
  category: string;
  key: ThemeColorKeyName;
  label: string;
}[];

// ---------------------------------------------------------------------------
// 3. Theme color value contract
// ---------------------------------------------------------------------------

/**
 * 테마 색 값의 계약 — 불투명 hex(3·6자리)만. **alpha(4·8자리)는 의도적으로
 * 거부한다**(적대 리뷰 2라운드): 파생 색 계산(color-contrast의 parseHexColor)이
 * alpha를 절삭해 `#00000000`을 불투명 검정으로 판단하므로, 투명 accent를
 * 받으면 흰 foreground가 파생되어 실제 화면 대비가 1:1이 된다 — WCAG 보장이
 * 조용히 무너진다. `<input type="color">`도 6자리만 표현한다. alpha hex를
 * 허용하려면 합성 표면색 기준의 대비 계산이 먼저다. (v22 이전 import가
 * 무검증이라 통과시킨 alpha 테마는 v22 마이그레이션이 base 기본값으로 되돌린다.)
 */
export const THEME_COLOR_VALUE_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// ---------------------------------------------------------------------------
// 4. Keys added after palettes were already being written
// ---------------------------------------------------------------------------

/**
 * 팔레트에 **그 팔레트가 쓰인 뒤에 생긴 키**를 그 키의 별칭(`aliasOf`) 값으로 채운 사본.
 *
 * 테마 패키지 포맷은 v0.7.4 에 24키로 나갔다 — 그 릴리스가 내보낸 패키지·JSON 과 그때
 * 저장된 사용자 테마가 전부 24키다. #722 가 25번째 키를 더했고, 전 키를 요구하는 읽기는
 * 그 팔레트들을 불완전하다고 판정했다(설치기는 팔레트를 통째로 버리고, 테마 편집기는 빈
 * 색 피커를 그렸다). 채우는 값은 그 키가 빠졌을 때 cascade 가 그리는 값이다 —
 * `semantic-*.css` 의 별칭이 같은 키를 가리키고, 테스트가 둘의 일치를 고정한다. 그래서
 * **채우는 순간에는** 채운 팔레트가 채우기 전과 똑같이 그려진다.
 *
 * 채운 뒤에는 별칭을 따라가지 않는다 — 값이 그 칸에 박히기 때문이다. v0.7.4 테마를 편집기로
 * 열어 본문 글자색만 바꿔 저장하면 안내선 색조는 옛 글자색에 남는다. #722 이후 만든 모든
 * 팔레트가 이미 그렇게 동작하므로(색조는 독립된 칸이다) 채움은 옛 팔레트를 그 모델로 옮긴다.
 *
 * 이 함수는 **불완전한 팔레트를 완전하게 만들지 않는다**: 별칭이 없는 키(v0.7.4 의 24키)가
 * 빠진 팔레트는 여전히 그 키가 빠진 채로 돌아가고, 전 키를 요구하는 호출자가 그대로 거부한다.
 * 채우는 것은 팔레트에 없는 키(`undefined`)뿐이다 — 있는데 형식이 틀린 값은 호출자의 검증에
 * 맡긴다. 별칭의 값도 없으면 아무것도 지어내지 않는다.
 *
 * ‼️ 키를 더할 때 `aliasOf` 없이 더하면 그 키가 필수가 되고 그 전의 팔레트가 전부 불완전해진다.
 * `theme-color-keys.test.ts` 가 별칭 없는 키 집합을 v0.7.4 의 24키로 고정해 그것을 막는다.
 */
export function fillAliasedColors<T extends Readonly<Record<string, unknown>>>(
  colors: T,
): Partial<Record<ThemeColorKey, T[keyof T]>> & T {
  const filled: Record<string, unknown> = { ...colors };
  for (const entry of THEME_COLOR_KEYS) {
    if (!("aliasOf" in entry)) continue;
    if (filled[entry.key] !== undefined) continue;
    const alias = filled[entry.aliasOf];
    if (alias !== undefined) filled[entry.key] = alias;
  }
  // 채운 값은 모두 같은 팔레트의 다른 칸에서 왔으므로 값 타입은 `T[keyof T]` 그대로다.
  return filled as Partial<Record<ThemeColorKey, T[keyof T]>> & T;
}
