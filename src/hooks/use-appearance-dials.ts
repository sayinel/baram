// §364 병합 결과를 문서 루트에 주입한다. 세 층(기본 → 테마 → 사용자)이 모두
// 실데이터로 흐른다 — 테마 층은 §371 이 매니페스트에 `dials` 를 실으면서 채워졌고,
// `useThemeDials` 가 그 층의 단일 출처다.

import { useEffect } from "react";

import type { DialContext } from "../appearance/dials";

import { useShallow } from "zustand/shallow";

import { applyDialVars } from "../appearance/apply";
import { resolveDials } from "../appearance/merge";
import { useSettingsStore } from "../stores/settings/store";
import { useThemeDials } from "./use-theme-dials";

export function useAppearanceDials(): void {
  const { appearanceOverrides } = useSettingsStore(
    useShallow((s) => ({ appearanceOverrides: s.appearanceOverrides })),
  );
  // 참조가 안정적이라 deps 로 쓸 수 있다 — `use-theme-dials.ts` 의 계약이고,
  // 깨지면 이 이펙트가 매 렌더 돌며 `<html>` 에 같은 값을 다시 쓴다.
  const themeDials = useThemeDials();

  useEffect(() => {
    // ‼️ 아직 관측되지 않는 값이다 — 적용되는 여섯 다이얼 전부가 `channel: "layout"`
    // 이고 그중 어느 것도 컨텍스트를 읽지 않는다. `prefers-color-scheme` 를 여기서
    // 읽으면 아무도 소비하지 않는 다섯 번째 리스너가 생긴다. Task 5 가 색 다이얼을
    // 들이면서 이 자리를 테마 인지 컨텍스트로 교체한다.
    const ctx: DialContext = { mode: "light", seeds: {} };
    applyDialVars(
      document.documentElement,
      resolveDials(themeDials, appearanceOverrides),
      ctx,
    );
  }, [themeDials, appearanceOverrides]);
}
