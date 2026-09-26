// §351 입고 있는 테마의 CSS 가 선언한 서체 패밀리(소문자) — 가용성 판정의 "theme" 갈래(스펙 0060
// §7.2). 테마 정의와 CSS 는 적용 이펙트(`use-settings-effects.ts`)와 **같은** 출처에서 읽는다 —
// `findThemeById(유효 id, lookupThemes(…, CSS 캐시))`. 모드는 합친다(서체 파일은 모드와 무관하다) —
// 단 합집합은 CSS 가 손에 있는 모드에 대한 것이다. 설치 테마의 CSS 는 `useThemeCssHydration` 이
// **현재** 모드(OS 명암 설정으로 고른 것) 하나만 디스크에서 캐시로 읽고, 캐시에 쓰는 곳은 그 훅뿐이다
// (2026-09-26, 테스트 밖에서 `setCss` · 캐시 스토어 `setState` 를 부르는 곳 전수) — 그래서 다른 모드는
// 이 세션에 그 모드로 이 테마를 입은 적이 있어야 센다.

import { useMemo } from "react";

import { useShallow } from "zustand/shallow";

import { useSettingsStore } from "../stores/settings/store";
import { useThemeCssCacheStore } from "../stores/system/theme-css-cache";
import { lookupThemes } from "../themes/installed-theme-defs";
import { findThemeById, THEME_MODES } from "../types/theme";
import { fontFaceFamilies } from "../utils/theme-css/font-faces";
import { useEffectiveThemeId } from "./use-effective-theme-id";

const NONE: ReadonlySet<string> = new Set();

export function useThemeFontFamilies(): ReadonlySet<string> {
  const { effectiveThemeId } = useEffectiveThemeId();
  const { customThemes, installedThemes } = useSettingsStore(
    useShallow((s) => ({
      customThemes: s.customThemes,
      installedThemes: s.installedThemes,
    })),
  );
  const cssCacheEntries = useThemeCssCacheStore((s) => s.entries);
  return useMemo(() => {
    const theme = findThemeById(
      effectiveThemeId,
      lookupThemes(customThemes, installedThemes, cssCacheEntries),
    );
    if (theme === undefined) return NONE;
    const families = new Set<string>();
    for (const mode of THEME_MODES) {
      const css = theme.modes[mode]?.css;
      if (css === undefined) continue;
      for (const name of fontFaceFamilies(css)) {
        families.add(name.toLowerCase());
      }
    }
    return families.size === 0 ? NONE : families;
  }, [effectiveThemeId, customThemes, installedThemes, cssCacheEntries]);
}
