// §365 다이얼 6 — 병합된 본문 타이포(스펙 0060 §4). 넷을 이 묶음(`EditorTypography`)으로 읽는
// 소비자는 전부 이것을 거친다: 훅 `useEditorTypography` 와 React 밖 `readEditorTypography`(둘 다
// `hooks/use-editor-typography.ts`), 병합 결과를 이미 가진 `use-settings-effects.ts`
// (`editorTypographyOf`, 계획 0107 P3), 그리고 두 층을 이미 가진
// `components/settings/settings-registry.ts`(`resolveEditorTypography` — 코드 크기 계산과 연동 스위치).
//
// 경계: 넷을 묶음으로 읽지 않는 설정 UI 는 여기를 거치지 않고 `resolveDials(...)` 를 직접 부른다 —
// 다이얼 하나를 id 로 읽는 행(`settings-registry.ts` 의 다이얼 슬라이더 · 셀렉트 도우미,
// `appearance-dial-row.tsx`, 사용자 층을 뺀 병합도 묻는 `dial-origin-slot.tsx`)과, 넷 밖의 다이얼
// (폭 · 자간 · 여백)을 읽는 `editor-width-row.tsx`(넷 중 서체 · 크기는 `useEditorTypography` 로 읽는다).
// `resolveDials(` 를 부르는 파일 전수(2026-09-26, 테스트와 정의 `merge.ts` 밖 — `find src \( -name
// '*.ts' -o -name '*.tsx' \) | grep -v __tests__ | xargs grep -ln 'resolveDials('`): 이 파일 ·
// `hooks/use-appearance-dials.ts`(그 결과는 `use-settings-effects.ts` 에서 `editorTypographyOf` 로만
// 넷에 닿는다) · 위 설정 UI 넷.
//
// 필드 이름이 옮기기 전 설정 필드와 같은 이유: 소비자의 구조 분해가 그대로 남아, 바뀌는 것이
// "어디서 읽는가" 하나로 좁혀진다.

import type { DialId, DialValues } from "./dials";
import type { ResolvedDial } from "./merge";

import { resolveDials } from "./merge";

export interface EditorTypography {
  readonly codeFontFamily: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

/**
 * 병합 결과에서 넷을 고른다.
 *
 * `typeof` 갈래가 있는 이유: `resolveDials` 가 돌려주는 값은 그 다이얼의 `parse` 를 지났으므로
 * 종류가 맞지만, 타입은 그것을 모른다(`ResolvedDial.value` 는 `number | string`). 어긋나는
 * 갈래의 대체값은 다이얼 기본값과 같다 — `editor-typography.test.ts` 가 고정한다.
 */
export function editorTypographyOf(
  resolved: Record<DialId, ResolvedDial>,
): EditorTypography {
  return {
    codeFontFamily: textOf(resolved.editorCodeFontFamily, ""),
    fontFamily: textOf(resolved.editorFontFamily, ""),
    fontSize: numberOf(resolved.editorFontSize, 16),
    lineHeight: numberOf(resolved.editorLineHeight, 1.75),
  };
}

/** 기본 → 테마 → 사용자 병합 뒤 넷을 고른다. */
export function resolveEditorTypography(
  theme: DialValues,
  user: DialValues,
): EditorTypography {
  return editorTypographyOf(resolveDials(theme, user));
}

function numberOf(dial: ResolvedDial, fallback: number): number {
  return typeof dial.value === "number" ? dial.value : fallback;
}

function textOf(dial: ResolvedDial, fallback: string): string {
  return typeof dial.value === "string" ? dial.value : fallback;
}
