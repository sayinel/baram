// §324-a 캡처 append의 결과를 사용자에게 알린다 — 어디에 붙었는지, 그리로 어떻게
// 가는지, 그리고 못 붙였다면 왜인지.
//
// 표면이 둘이라 이름이 "toast"가 아니다: 성공과 폴백은 토스트로 말하고, 실패는
// 다이얼로그 안의 오류 줄(`setSaveError`)로 말한다. 실패를 토스트로 옮기지 않는 이유는
// 실패한 저장은 다이얼로그를 **열어 둔 채**로 두기 때문이다 — 원인은 사용자가 다시
// 누를 버튼 옆에 있어야 하고, 3초 뒤 사라져서는 안 된다.
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
  unmatchedTags: string[],
  t: Translate,
): void {
  if (appended.length === 0) return;

  // §324-a 아무것도 못 맞힌 태그가 있으면 성공 문구가 그것을 **함께** 말한다. 태그 하나가
  // 맞았다고 나머지 오타를 삼키면, 성공처럼 보이는 캡처 안에 아무 데도 닿지 않은 태그가
  // 조용히 남는다.
  //
  // ‼️ 두 문장을 이어 붙이지 않고 전용 키를 쓴다. 조사·어순이 언어마다 다르므로
  // 문자열 연결은 한국어에서 곧바로 어색해진다.
  const tags = unmatchedTags.map((tag) => `#${tag}`).join(" ");
  const { showToast } = useUIStore.getState();

  if (appended.length > 1) {
    const count = String(appended.length);
    showToast(
      tags
        ? t("journal.capture.appended.manyUnmatched", { count, tags })
        : t("journal.capture.appended.many", { count }),
      "info",
    );
    return;
  }

  const [target] = appended;
  showToast(
    tags
      ? t("journal.capture.appended.oneUnmatched", {
          tags,
          title: target.title,
        })
      : t("journal.capture.appended.one", { title: target.title }),
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
 * ‼️ 닿지 않은 태그를 **전부** 말한다. 하나만 말하면 둘을 잘못 적은 사용자가 하나를
 * 고치고 나머지가 여전히 아무 데도 닿지 않는다는 것을 모른 채 다음 캡처로 넘어간다.
 *
 * 태그를 아예 안 적었으면 아무 말도 하지 않는다. 대상을 지목하지 않은 것은 실패가
 * 아니라 §99의 정상 동작이다.
 */
export function showInboxFallbackToast(
  unmatchedTags: string[],
  t: Translate,
): void {
  if (unmatchedTags.length === 0) return;
  const tags = unmatchedTags.map((tag) => `#${tag}`).join(" ");
  useUIStore
    .getState()
    .showToast(t("journal.capture.inboxFallback", { tags }), "warning");
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
