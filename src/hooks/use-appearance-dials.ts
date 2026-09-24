// §364 병합 결과를 문서 루트에 주입한다. 세 층(기본 → 테마 → 사용자)이 모두
// 실데이터로 흐른다 — 테마 층은 §371 이 매니페스트에 `dials` 를 실으면서 채워졌고,
// `useThemeDials` 가 그 층의 단일 출처다.
//
// §367 이후 이 훅은 병합 결과를 **반환도 한다**. 레이아웃 채널은 여기서 계속 쓰고,
// 색 채널은 테마 이펙트가 가져간다(`appearance/apply.ts` 의 `colorDialVars`).

import { useEffect, useMemo } from "react";

import type { DialContext, DialId } from "../appearance/dials";
import type { ResolvedDial } from "../appearance/merge";

import { useShallow } from "zustand/shallow";

import { applyDialVars } from "../appearance/apply";
import { resolveDials } from "../appearance/merge";
import { useSettingsStore } from "../stores/settings/store";
import { useThemeDials } from "./use-theme-dials";

export function useAppearanceDials(): Record<DialId, ResolvedDial> {
  const { appearanceOverrides } = useSettingsStore(
    useShallow((s) => ({ appearanceOverrides: s.appearanceOverrides })),
  );
  // 참조가 안정적이라 deps 로 쓸 수 있다 — `use-theme-dials.ts` 의 계약이고,
  // 깨지면 이 이펙트가 매 렌더 돌며 `<html>` 에 같은 값을 다시 쓴다.
  const themeDials = useThemeDials();
  // ‼️ `useMemo` 는 여기서 성능이 아니라 **계약**이다. 반환값이 테마 이펙트의 deps 로
  // 가므로(`use-settings-effects.ts`), 매 렌더 새 객체를 만들면 그 이펙트가 매 렌더
  // 돌며 `clearThemeVars` → 재적용을 반복한다.
  const resolved = useMemo(
    () => resolveDials(themeDials, appearanceOverrides),
    [themeDials, appearanceOverrides],
  );

  useEffect(() => {
    // ‼️ `mode: "light"` 를 상수로 두는 것이 옳다. 이 호출이 쓰는 것은 레이아웃
    // 채널뿐이고(`applyDialVars` 가 색 채널을 건너뛴다), 레이아웃 다이얼은
    // 컨텍스트를 읽지 않는다 — Task 1 의 채널 테스트가 "레이아웃 다이얼은
    // `--color-*` 를 선언하지 않는다" 를 고정하므로 이 상수가 관측되는 경로가 없다.
    // 여기서 모드를 `matchMedia` 로 따라가면 읽히지도 않는 값을 위해 다섯 번째
    // `prefers-color-scheme` 리스너가 생긴다 — 테스트 밖 `src/**/*.{ts,tsx}` 에서 그
    // 쿼리에 `change` 리스너를 거는 자리는 넷이다(2026-09-24): `code-block-highlight.ts` ·
    // `use-graph-colors.ts` · `use-theme-css-hydration.ts` · `use-settings-effects.ts`.
    const ctx: DialContext = { mode: "light", seeds: {} };
    applyDialVars(document.documentElement, resolved, ctx);
  }, [resolved]);

  return resolved;
}
