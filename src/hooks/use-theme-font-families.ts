// §351 입고 있는 테마의 CSS 가 선언한 서체 패밀리(소문자) — 가용성 판정의 "theme" 갈래(스펙 0060
// §7.2). 테마 정의와 CSS 는 적용 이펙트(`use-settings-effects.ts`)와 **같은** 출처에서 읽는다 —
// `findThemeById(유효 id, lookupThemes(…, CSS 캐시))`. 두 모드를 합친다: 서체 파일은 모드와 무관하다.

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
