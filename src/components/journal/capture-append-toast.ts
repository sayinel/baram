// §324-a 캡처가 **어디에** 붙었는지 알리고, 그리로 갈 수 있게 한다.
//
// 이 모듈이 다이얼로그 밖에 있는 이유는 크기가 아니라 방향이다: 여기서만 탭을 여는
// 서비스(`journal-file-service`)와 디스크 읽기(`ipc/invoke`)에 닿는다. 저장 분기는
// "무엇이 붙었는지"만 알고, 그것을 어떻게 알릴지는 이 파일이 안다.

import type { Translate } from "../../i18n/useTranslation";
import type { AppendedTarget } from "../../services/capture-append";

import { readFile } from "../../ipc/invoke";
import { CaptureAppendError } from "../../services/capture-append";
import { openFileInTab } from "../../services/journal-file-service";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";

/**
 * 붙은 대상을 알린다.
 *
 * 하나면 그 이름을 말하고 `[열기]`를 준다. 둘 이상이면 개수만 말하고 행동은 주지
 * 않는다 — 어느 것을 열지 정할 근거가 없고, 임의로 첫째를 여는 것은 사용자가 지목하지
 * 않은 선택이다.
 *
 * 빈 목록에는 아무 말도 하지 않는다: 부분 성공 경로(`CaptureAppendError.appended`)가
 * 그대로 넘겨 부르므로, 아무것도 못 붙인 실패에서 "0개에 추가됨"이 뜨면 안 된다.
 */
export function showAppendedToast(
  appended: AppendedTarget[],
  t: Translate,
): void {
  if (appended.length === 0) return;

  const { showToast } = useUIStore.getState();
  if (appended.length > 1) {
    showToast(
      t("journal.capture.appended.many", { count: String(appended.length) }),
      "info",
    );
    return;
  }

  const [target] = appended;
  showToast(
    t("journal.capture.appended.one", { title: target.title }),
    "info",
    undefined,
    {
      label: t("journal.capture.appended.open"),
      onClick: () => void openAppendedNote(target.path),
    },
  );
}

/**
 * 매칭이 하나도 없어 `inbox/`로 갔다는 것 — §324-a의 핵심.
 *
 * ‼️ 문구도 타입도 성공과 **다르다**(`"warning"`). 같은 모양으로 알리면 `#영감노드`
 * 같은 오타가 성공처럼 보이고, 캡처는 아무도 열지 않는 `inbox/`에 조용히 쌓인다 —
 * 이 작업이 없애려는 바로 그 실패다.
 *
 * 태그를 아예 안 적었으면(`tag`가 없으면) 아무 말도 하지 않는다. 대상을 지목하지
 * 않은 것은 실패가 아니라 §99의 정상 동작이다.
 */
export function showInboxFallbackToast(
  tag: string | undefined,
  t: Translate,
): void {
  if (!tag) return;
  useUIStore
    .getState()
    .showToast(t("journal.capture.inboxFallback", { tag }), "warning");
}

/**
 * 실패 문구. `dirtyTab`은 사용자가 **풀 수 있는** 상태라 그 방법까지 말한다.
 *
 * `CaptureAppendError`가 아닌 것은 계약상 오지 않는다(`appendCaptureToNotes`는 언제나
 * 그 타입을 던진다). 그래도 이름 없는 문구로 얼버무리지 않고 원인을 그대로 실어
 * 보낸다 — 그날이 오면 원인이 필요한 쪽은 사용자다.
 */
export function appendErrorMessage(err: unknown, t: Translate): string {
  if (!(err instanceof CaptureAppendError)) {
    return t("journal.capture.error.save", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return err.code === "dirtyTab"
    ? t("journal.capture.error.appendDirtyTab", { title: err.title })
    : t("journal.capture.error.append", { title: err.title });
}

/**
 * `[열기]`가 하는 일. 내용은 **디스크에서 다시 읽는다** — 방금 붙인 항목이 들어 있는
 * 판본이어야 하고, `openFileInTab`은 더티 탭의 편집 내용은 스스로 지킨다.
 */
async function openAppendedNote(path: string): Promise<void> {
  try {
    await openFileInTab(path, await readFile(path));
  } catch (err) {
    logger.error("[QuickCapture] Opening the appended note failed:", err);
  }
}
