// §305 쓰기가 소스·문서 경로에서 낙관적 잠금에 거절됐을 때 사용자에게 알린다.
//
// 이 `stale`은 디스크 `stale`과 성질이 다르다. 디스크 쪽은 파일을 다시 읽으면 저절로
// 수습되는 일시적 경합이지만, 소스·문서 쪽은 **저장할 때까지 영구적**이다 — 태스크
// 스토어가 그 파일에 대해 계속 낡아 있으므로 같은 조작을 몇 번 반복해도 같은 자리에서
// 거절된다.
//
// 그렇다고 디스크를 다시 읽어 고칠 수는 없다: 그 파일의 진실은 아직 저장되지 않은
// 버퍼이고, 다시 읽으면 같은 세션이 그 버퍼에 만들어 둔 **다른 줄의** 변경까지 옛 디스크
// 내용으로 되돌아간다(`isDiskAuthoritative`가 존재하는 이유). 스토어를 만지지 않는 것이
// 맞고, 남는 선택지는 말해 주는 것뿐이다 — 침묵하면 "원인 모를 죽은 체크박스"(I5)가 된다.
//
// §306 토글과 §312 정리 메뉴가 같은 분기를 각자 갖고 있으므로 문구와 토스트 종류를
// 여기 한 곳에 둔다.
import type { Translate } from "../../i18n/useTranslation";

import { useUIStore } from "../../stores/ui/ui";

/** 오류가 아니라 사실 통지다 — 사용자가 잘못한 것이 없으므로 `info`다. */
export function notifyUnsavedConflict(t: Translate): void {
  useUIStore.getState().showToast(t("tasks.unsavedConflict"), "info");
}
