// §370 크롬 가시성 섹션 — 활동 표시줄 · 상태 표시줄 · 탭 표시줄, 세 토글.
//
// 사이드바 · 우측 패널은 넣지 않는다 — 이미 자기 토글 버튼과 단축키가 있고, 설정에
// 중복 진입점을 만들면 어느 쪽이 참인지 물어야 한다(task-5-brief.md 부록-5).
//
// ‼️ `setChromeVisibility`를 부르지 않는다 — 그건 프리셋 전용 입구다
// (`stores/ui/ui.ts`의 `setChromeVisibility` 주석). 이 세 토글은 각자
// `toggleActivityBar` · `toggleStatusBar` · `toggleTabBar`를 부르고, 그 셋만이
// "사용자가 이 표면을 손댔다"를 `chromeTouched`에 기록한다(§370.3) — 여기서
// 프리셋 입구를 부르면 테마의 제안이 사용자의 선택을 덮게 된다.
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../../i18n/useTranslation";
import { useUIStore } from "../../../../stores/ui/ui";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../../settings-shared";

export function ChromeVisibilitySection() {
  const { t } = useTranslation();
  const {
    activityBarVisible,
    statusBarVisible,
    tabBarVisible,
    toggleActivityBar,
    toggleStatusBar,
    toggleTabBar,
  } = useUIStore(
    useShallow((s) => ({
      activityBarVisible: s.activityBarVisible,
      statusBarVisible: s.statusBarVisible,
      tabBarVisible: s.tabBarVisible,
      toggleActivityBar: s.toggleActivityBar,
      toggleStatusBar: s.toggleStatusBar,
      toggleTabBar: s.toggleTabBar,
    })),
  );

  return (
    <>
      <SettingsSectionHeader
        title={t("settings.activitybar.chromeVisibility")}
      />
      <SettingsRow
        description={t(
          "settings.activitybar.chromeVisibility.activityBar.desc",
        )}
        label={t("settings.activitybar.chromeVisibility.activityBar")}
      >
        <ToggleSwitch
          checked={activityBarVisible}
          onChange={() => toggleActivityBar()}
        />
      </SettingsRow>
      <SettingsRow
        description={t("settings.activitybar.chromeVisibility.statusBar.desc")}
        label={t("settings.activitybar.chromeVisibility.statusBar")}
      >
        <ToggleSwitch
          checked={statusBarVisible}
          onChange={() => toggleStatusBar()}
        />
      </SettingsRow>
      <SettingsRow
        description={t("settings.activitybar.chromeVisibility.tabBar.desc")}
        label={t("settings.activitybar.chromeVisibility.tabBar")}
      >
        <ToggleSwitch checked={tabBarVisible} onChange={() => toggleTabBar()} />
      </SettingsRow>
    </>
  );
}
