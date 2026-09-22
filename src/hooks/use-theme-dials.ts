// §366 테마 층의 단일 출처. 이 층을 읽는 자리가 저마다 자기 것을 조립하면
// `<html>` 에 적용된 값과 설정 화면의 출처 배지가 어긋난다 — 배지는 "이 값이
// 어디서 왔는가" 를 말하는 UI 이므로 어긋나면 그 자체가 거짓말이다.
//
// 철회된 테마는 여기서도 빠진다. `useEffectiveThemeId` 가 `"system"` 을 돌려주고
// `themeDialsFor("system", …)` 는 빈 층이다 — 철회된 테마의 색은 벗기면서 그
// 테마의 본문 폭은 그대로 두는 상태가 생기지 않는다.

import type { DialValues } from "../appearance/dials";

import { themeDialsFor } from "../appearance/theme-dials";
import { useSettingsStore } from "../stores/settings/store";
import { useEffectiveThemeId } from "./use-effective-theme-id";

/**
 * 지금 입고 있는 테마가 제안하는 다이얼 값 — 병합기의 `theme` 층 그 자체다.
 *
 * ‼️ 반환 참조가 안정적이라는 것이 이 훅의 계약이다(`themeDialsFor` 가 스토어 객체의
 * 일부이거나 모듈 상수를 그대로 돌려준다). `use-appearance-dials.ts` 가 이 값을 이펙트
 * deps 에 넣으므로, 여기서 매 렌더 새 객체를 만들면 그 이펙트가 매 렌더 돈다.
 */
export function useThemeDials(): DialValues {
  const { effectiveThemeId } = useEffectiveThemeId();
  const installedThemes = useSettingsStore((s) => s.installedThemes);
  return themeDialsFor(effectiveThemeId, installedThemes);
}
