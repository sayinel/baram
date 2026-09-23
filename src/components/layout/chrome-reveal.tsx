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
  // 없다.
  //
  // 이 조건은 **세 가시성 플래그**를 읽지, 실제로 그려진 것을 읽지 않는다 — 알려진
  // 간극이 하나 있다: 폴더가 열려 있고, 단축키로 활동 표시줄·상태 표시줄을 껐고, 탭을
  // 전부 닫으면(`TabBar`는 탭 0개에서 `return null`, `TabBar.tsx:279` — `App.tsx:388`가
  // 그 앞에서 `tabBarVisible`로만 게이팅) §370 크롬은 아무것도 그려지지 않는데
  // `tabBarVisible`은 여전히 `true`라 이 버튼이 뜨지 않는다. 게이팅 조건을 `TabBar`의
  // 빈 상태에 결합하지 않는다 — 서로 무관한 두 렌더를 묶는 것이 이 간극보다 나쁜
  // 구조다.
  //
  // 그래도 §370.2가 성립하는 것은, 이 렌더와 무관하게 실제로 동작하는 경로가 셋
  // 있어서다(코드로 확인함): 단축키(`Mod+Alt+A/S/B` — 문서 레벨 키다운이라 DOM에
  // 그려진 크롬과 무관), 네이티브 "Perspective" 메뉴(`menu.rs`의 OS 메뉴바 — Writing 등
  // 다른 프리셋을 고르면 `applyPreset`이 `setChromeVisibility`로 셋을 되살린다), 그리고
  // 명령 팔레트(전역 단축키로 열어 "Writing Perspective" 실행)와 설정(전역 단축키로
  // 열어 `ChromeVisibilitySection`의 토글). 이 버튼은 그 위에 얹힌 추가 편의이지 유일한
  // 복귀 경로가 아니다.
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
