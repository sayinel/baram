// §364 병합 결과를 문서 루트에 주입한다. 테마 층은 아직 비어 있다 —
// 매니페스트가 다이얼 값을 싣는 것은 후속 계획(0096 · §371)이다. 자리를
// 지금 비워 두는 것은 병합기의 층 순서를 뒤에 바꾸지 않기 위해서다.

import { useEffect } from "react";

import type { DialValues } from "../appearance/dials";

import { useShallow } from "zustand/shallow";

import { applyDialVars } from "../appearance/apply";
import { resolveDials } from "../appearance/merge";
import { useSettingsStore } from "../stores/settings/store";

const NO_THEME_DIALS: DialValues = {};

export function useAppearanceDials(): void {
  const { appearanceOverrides } = useSettingsStore(
    useShallow((s) => ({ appearanceOverrides: s.appearanceOverrides })),
  );

  useEffect(() => {
    applyDialVars(
      document.documentElement,
      resolveDials(NO_THEME_DIALS, appearanceOverrides),
    );
  }, [appearanceOverrides]);
}
