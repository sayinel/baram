// §54 외관 설정 — 섹션 조립과 하위 화면 라우팅만 한다.
//
// 갤러리·워크스페이스 프리셋은 각자의 파일로 나갔다(이 파일이 516줄이었다).
// 하위 화면(ThemeEditor, 후속 계획의 ThemeBrowser)은 탭 본문을 통째로 교체한다 —
// 설정 모달을 닫지 않기 위해서다(스펙 0049 §10.2).
import { useState } from "react";

import { useTranslation } from "../../../i18n/useTranslation";
import { SettingsSectionHeader } from "../settings-shared";
import { ThemeEditor } from "../ThemeEditor";
import { ThemeGallery } from "./theme-gallery";
import { WorkspacePresets } from "./workspace-presets";

export function AppearanceTab() {
  const { t } = useTranslation();
  const [editingTheme, setEditingTheme] = useState(false);

  if (editingTheme) {
    return <ThemeEditor onClose={() => setEditingTheme(false)} />;
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.appearance.theme")} />
      <ThemeGallery onCustomize={() => setEditingTheme(true)} />
      <SettingsSectionHeader
        title={t("settings.appearance.workspacePresets")}
      />
      <WorkspacePresets />
    </div>
  );
}
