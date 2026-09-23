// §365.4 / §370 레이아웃 축 조립 — 화면에 무엇이 있는가(크롬 가시성 · 화면구성
// 프리셋 · 활동표시줄 항목)는 전부 여기 모인다. 외관 탭은 꾸밈(테마 · 강조색
// 다이얼)만 남긴다(task-5-brief.md, 컨트롤러 부록 R-C). 탭 id는 `activitybar`
// 그대로다 — `SettingsTab` 유니온과 설정 검색이 그 문자열을 키로 쓴다.
//
// 섹션 셋을 조립만 한다 — 각 섹션의 로직은 `tabs/layout/`(tabs/general/과 같은
// 패턴)과 `workspace-presets.tsx`에 있다.
import { useTranslation } from "../../../i18n/useTranslation";
import { SettingsSectionHeader } from "../settings-shared";
import { ActivityBarItemsSection } from "./layout/ActivityBarItemsSection";
import { ChromeVisibilitySection } from "./layout/ChromeVisibilitySection";
import { WorkspacePresets } from "./workspace-presets";

export function ActivityBarTab() {
  const { t } = useTranslation();

  return (
    <div className="settings-section">
      <ChromeVisibilitySection />
      <SettingsSectionHeader
        title={t("settings.appearance.workspacePresets")}
      />
      <WorkspacePresets />
      <ActivityBarItemsSection />
    </div>
  );
}
