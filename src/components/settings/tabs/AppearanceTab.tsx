// §54 외관 설정 — 섹션 조립과 하위 화면 라우팅만 한다.
//
// 갤러리·워크스페이스 프리셋은 각자의 파일로 나갔다(이 파일이 516줄이었다).
// 하위 화면(ThemeEditor, ThemeBrowser)은 탭 본문을 통째로 교체한다 —
// 설정 모달을 닫지 않기 위해서다(스펙 0049 §10.2).
//
// ‼️ 하위 화면은 단일 union 상태다(§361) — boolean 두 개(editingTheme·browsingThemes)를
// 나란히 두면 "둘 다 true"라는 표현 불가능한 상태가 생기고, 어느 쪽이 이기는지는 아래
// if 순서라는 우연이 정한다. 세 번째 하위 화면이 생기면 이 union에 갈래를 추가한다.
import { useState } from "react";

import { useTranslation } from "../../../i18n/useTranslation";
import { AppearanceDialRow } from "../appearance-dial-row";
import { SettingsSectionHeader } from "../settings-shared";
import { ThemeEditor } from "../ThemeEditor";
import { ThemeGallery } from "./theme-gallery";
import { ThemeBrowser } from "./ThemeBrowser";
import { WorkspacePresets } from "./workspace-presets";

type SubScreen = "browser" | "editor" | null;

export function AppearanceTab() {
  const { t } = useTranslation();
  const [subScreen, setSubScreen] = useState<SubScreen>(null);

  if (subScreen === "editor") {
    return <ThemeEditor onClose={() => setSubScreen(null)} />;
  }
  if (subScreen === "browser") {
    return <ThemeBrowser onBack={() => setSubScreen(null)} />;
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.appearance.theme")} />
      <ThemeGallery
        onBrowseThemes={() => setSubScreen("browser")}
        onCustomize={() => setSubScreen("editor")}
      />
      <SettingsSectionHeader
        title={t("settings.appearance.workspacePresets")}
      />
      <WorkspacePresets />
      {/* §366 다이얼 두 개 — 출처 배지와 되돌리기는 AppearanceDialRow 안에 산다. */}
      <SettingsSectionHeader title={t("settings.appearance.layout")} />
      <AppearanceDialRow
        dialId="editorMaxWidth"
        label={t("settings.appearance.lineWidth")}
      />
      <AppearanceDialRow
        dialId="editorPadding"
        label={t("settings.appearance.editorPadding")}
      />
    </div>
  );
}
