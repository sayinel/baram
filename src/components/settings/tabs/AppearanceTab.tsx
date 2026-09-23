// §54 외관 설정 — 섹션 조립과 하위 화면 라우팅만 한다. 꾸밈(테마 · 강조색
// 다이얼)만 남긴다 — 화면에 무엇이 있는가(화면구성 프리셋 등)는 `ActivityBarTab.tsx`
// 로 옮겨 갔다(§365.4, task-5-brief.md). 테마 갤러리는 여전히 각자의 파일에 있다
// (이 파일이 한때 516줄이었다).
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
      {/* §367 — 강조색 다이얼은 앱 전체의 겉모습을 바꾸므로 에디터 탭이 아니라
          여기다(§365.4: 색 스킴·강조색·밀도·모서리는 외관). 갤러리 바로 아래에
          두는 이유는 이 둘이 **고른 테마의 강조색을 옮기는** 조정이라, 무엇을
          옮기는지가 바로 위에 보여야 하기 때문이다. */}
      <AppearanceDialRow
        dialId="accentHueShift"
        label={t("settings.appearance.accentHueShift")}
      />
      <AppearanceDialRow
        dialId="accentSaturationShift"
        label={t("settings.appearance.accentSaturationShift")}
      />
    </div>
  );
}
