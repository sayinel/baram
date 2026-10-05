// §386 모드 설정 행(스펙 0064 D2 · D3). 지금 입은 테마가 모드 설정을 따를 때만 그린다 —
// 한 모드짜리 테마에서는 그 테마의 모드가 언제나 이기므로(D4) 이 행은 눌러도 아무 일이 없는
// 컨트롤이 된다. 숨긴 동안 값은 그대로 남고, 따르는 테마로 돌아오면 이 행이 그 값을 보인다.
//
// 열거는 select 다 — 같은 탭의 열거 행(밀도 · 모서리 · 배경 대비)이 `.settings-select` 를 쓴다
// (`appearance-dial-row.tsx`, 계획 0114 P1).
import type { ColorModeSetting } from "../../../appearance/color-mode";

import { useShallow } from "zustand/shallow";

import {
  COLOR_MODE_SETTINGS,
  followsColorModeSetting,
} from "../../../appearance/color-mode";
import { useEffectiveThemeId } from "../../../hooks/use-effective-theme-id";
import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings/store";
import { lookupThemes } from "../../../themes/installed-theme-defs";
import { findThemeById } from "../../../types/theme";
import { SettingsRow } from "../settings-shared";

const OPTION_LABEL_KEYS: Record<ColorModeSetting, string> = {
  dark: "settings.appearance.colorMode.dark",
  light: "settings.appearance.colorMode.light",
  system: "settings.appearance.colorMode.system",
};

export function ColorModeRow() {
  const { t } = useTranslation();
  // 적용 이펙트(`use-settings-effects.ts`)와 같은 id — 회수된 테마는 여기서 이미 빠진다.
  const { effectiveThemeId } = useEffectiveThemeId();
  const { colorModeSetting, customThemes, installedThemes } = useSettingsStore(
    useShallow((s) => ({
      colorModeSetting: s.colorModeSetting,
      customThemes: s.customThemes,
      installedThemes: s.installedThemes,
    })),
  );
  // 적용 이펙트와 같은 조회다. `system` 과 해석되지 않는 id 는 둘 다 `undefined` 이고, 둘 다
  // 기본 팔레트 쌍으로 그려지므로 설정을 따른다(스펙 D2).
  const theme =
    effectiveThemeId === "system"
      ? undefined
      : findThemeById(
          effectiveThemeId,
          lookupThemes(customThemes, installedThemes),
        );
  if (!followsColorModeSetting(theme)) return null;

  return (
    <SettingsRow
      description={t("settings.appearance.colorMode.desc")}
      label={t("settings.appearance.colorMode")}
    >
      <select
        aria-label={t("settings.appearance.colorMode")}
        className="settings-select"
        onChange={(e) => {
          const next = COLOR_MODE_SETTINGS.find((s) => s === e.target.value);
          if (next !== undefined) {
            useSettingsStore.getState().setColorModeSetting(next);
          }
        }}
        value={colorModeSetting}
      >
        {COLOR_MODE_SETTINGS.map((setting) => (
          <option key={setting} value={setting}>
            {t(OPTION_LABEL_KEYS[setting])}
          </option>
        ))}
      </select>
    </SettingsRow>
  );
}
