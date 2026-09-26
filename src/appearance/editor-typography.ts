// §365 다이얼 6 — 병합된 본문 타이포(스펙 0060 §4). 소비자는 전부 이것을 거쳐 읽는다: 훅
// `useEditorTypography` 와 React 밖 `readEditorTypography`(둘 다 `hooks/use-editor-typography.ts`),
// 병합 결과를 이미 가진 `use-settings-effects.ts`(`editorTypographyOf`, 계획 0107 P3), 그리고 두
// 층을 이미 가진 `components/settings/settings-registry.ts`(`resolveEditorTypography`).
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
