// §370.2 복귀 경로 ② — 단축키를 모르거나 리매핑으로 지운 사용자를 위한, 마우스만으로
// 돌아올 길. 화면 위 가장자리에 얇은 버튼을 두고 평소엔 opacity로 숨기되(DOM에서 빼지
// 않는다 — CSS `display: none`·`visibility: hidden`은 포커스 순서에서도 빠진다), 포인터
// 호버와 `:focus-visible` 양쪽에서 드러낸다(`.chrome-reveal`, styles/layout.css). 시간
// 지연으로 뜨게 만들지 않는다 — 키보드에는 "호버 지속 시간"이 없다.
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { useUIStore } from "../../stores/ui/ui";

export function ChromeReveal() {
  const {
    activityBarVisible,
    revealAllChrome,
    statusBarVisible,
    tabBarVisible,
  } = useUIStore(
    useShallow((s) => ({
      activityBarVisible: s.activityBarVisible,
      revealAllChrome: s.revealAllChrome,
      statusBarVisible: s.statusBarVisible,
      tabBarVisible: s.tabBarVisible,
    })),
  );
  const { t } = useTranslation();

  // "전부 숨음"의 코퍼스는 이 계획이 더한 세 크롬 표면뿐이다(activityBarVisible ·
  // statusBarVisible · tabBarVisible) — sidebarOpen · rightPanelOpen은 포함하지 않는다.
  // 그 둘은 이미 자기 토글 버튼과 단축키(Mod+Shift+L 등)를 갖고 있어 이 경로가 필요
  // 없다. 표면 하나라도 보이면 설정·명령 팔레트로 돌아갈 길이 있으므로 렌더 자체를
  // 하지 않는다 — DOM에 없어야 포커스 순서에도 없다.
  if (activityBarVisible || statusBarVisible || tabBarVisible) return null;

  return (
    <button
      className="chrome-reveal"
      onClick={() => revealAllChrome()}
      type="button"
    >
      {t("chromeReveal.button")}
    </button>
  );
}
