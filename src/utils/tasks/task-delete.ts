// §312 줄 삭제 — 이 슬라이스의 유일한 **파괴적** 조작이고, 되돌릴 수 없다.
//
// 스냅샷(§71)은 파일 단위이고 태스크 줄 쓰기 경로를 타지 않는다. 자동 저장이 켜져 있으면
// 저장 전 경로의 삭제도 곧 디스크에 내려간다. 즉 지운 줄을 되살릴 통로가 이 앱에 없다 —
// 그래서 확인 관문이 UI의 장식이 아니라 이 조작의 일부다.
import type { TaskEntry } from "../../ipc/types";
import type { TaskTriageContext } from "./task-triage-write";

import { useTaskStore } from "../../stores/tasks/task-store";
import { showConfirm } from "../confirm-dialog";
import { applyTaskDelete } from "./apply-task-delete";
import { writeAndReconcile } from "./task-triage-write";

/**
 * 확인 중이거나 쓰는 중인 삭제가 있는가. 있으면 두 번째 요청은 **아무 일도 하지 않는다**.
 *
 * ‼️ 관문이 `await`이라 그 사이에 같은 조작이 한 번 더 들어올 수 있다. 그러면 대화상자가
 * 둘 쌓이고, 둘 다 확인하면 같은 인자로 `deleteTaskLine`이 두 번 나간다 — 낙관적 잠금이
 * 보는 것은 `(줄 번호, 원문)`뿐이므로 바이트가 같은 이웃 줄이 하나라도 있으면 **두 번째도
 * 통과해 다른 줄을 지운다.** 사용자가 지우라고 한 적 없는 줄이고, 되돌릴 통로가 없다.
 *
 * ‼️ 이것을 지금까지 막아 온 것은 `showConfirm`이 `requestAnimationFrame`에서 취소 버튼에
 * 주는 포커스뿐이었다 — 다른 네 호출부와 공유하는 대화상자 헬퍼의 **부수효과**이고, 이
 * 파일에는 그 의존이 적혀 있지 않았다. 그쪽을 고치지 않고 여기에 두는 이유가 셋이다:
 * - 포커스는 잠금이 아니다. 창이 숨으면 rAF는 지연되고, 행을 직접 겨냥한 dispatch는
 *   포커스와 무관하게 도착한다.
 * - 지켜야 할 불변식("되돌릴 수 없는 쓰기는 한 번에 하나")은 이 조작의 것이지 대화상자의
 *   것이 아니다. 대화상자 쪽에 두면 파괴적이지 않은 네 호출부까지 같은 규칙을 진다.
 * - 파일/폴더 삭제·Zettel 휴지통·하이라이트 삭제는 각자 다른 자리에서 확인을 띄운다.
 *   공유 헬퍼의 포커스 시점을 바꾸면 그 넷의 Enter·Escape 동작까지 함께 흔든다.
 *
 * 모듈 전역인 것은 의도다. 서로 다른 두 행을 동시에 지우는 것도 막는다 — 먼저 끝난 삭제가
 * 뒤 줄의 번호를 전부 하나씩 올리므로, 나중 삭제가 들고 있던 번호는 이미 다른 줄을 가리킨다.
 */
let deleteInFlight = false;

/**
 * 확인을 받고 태스크 줄을 지운다.
 *
 * ‼️ **확인이 먼저다.** 쓰기를 먼저 하고 확인을 나중에 물으면 "취소"가 아무 의미도 없어
 * 진다 — 사용자가 취소를 누른 시점에 줄은 이미 사라져 있고 되돌릴 방법이 없다. 순서를
 * 뒤집으면 `task-triage-delete.test.ts`의 두 테스트가 빨간불이 된다("취소하면 아무것도
 * 쓰지 않는다", "확인 대화상자가 열려 있는 동안에는 IPC가 나가지 않는다").
 *
 * 문구에는 지울 줄의 **원문**을 담는다. 아젠다 행이 보여 주는 것은 파서가 접어 놓은
 * 본문(`text`)이라 그것만으로는 어떤 줄이 사라지는지 확정할 수 없다 — 파괴적 조작의
 * 확인에서 그 차이는 다른 줄을 지우게 만든다.
 *
 * ‼️ `trimEnd()`이지 `trim()`이 아니다. 들여쓰기만 다른 부모/하위 항목은 `raw`의
 * **앞** 공백으로만 구별된다 — 여기서 지우면 두 줄이 문구에서 똑같아 보인다. 뒤 공백은
 * 정보가 없으므로 그대로 잘라도 된다. 앞 공백을 남겨도 `.ai-prompt-label`이 기본
 * `white-space: normal`이면 렌더링 단계에서 다시 접힌다 — 그래서 `toolbar.css`가 같은
 * 클래스에 `white-space: pre-wrap`을 짝으로 둔다(§312).
 *
 * 저장 전 경로의 회계는 `dropLineFromBuffer`가 갖는다 — 지운 항목을 빼고 그 **아래 줄
 * 번호를 하나씩 올린 뒤**, 그 파일의 번호가 이제 버퍼를 가리킨다고 표시한다.
 *
 * ‼️ 여기서 `refreshFileTasks`를 부르면 안 된다. 그 파일의 진실은 아직 저장되지 않은
 * 버퍼인데 디스크를 다시 읽으면 지운 줄이 되살아나고, 같은 세션이 그 버퍼에 만들어 둔
 * **다른 줄의** 변경까지 옛 내용으로 되돌아간다(`isDiskAuthoritative`가 존재하는 이유).
 *
 * `patchTask`로도 안 된다 — 그것은 `line`을 조인 키로 쓰는 **단건** 갱신이고 삭제가
 * 무효화하는 것은 그 키 자체다. 지운 줄보다 아래에 있던 태스크의 번호를 바로잡지 않으면
 * 그 다음 조작(체크·기한·태그)이 한 줄 아래에 쓴다. 디스크 경로는 이 계산을 하지 않는다:
 * 그쪽은 파일을 다시 읽어 파서가 센 번호를 그대로 받는다(`writeAndReconcile`).
 */
export async function confirmAndDeleteTaskLine(
  task: TaskEntry,
  ctx: TaskTriageContext,
): Promise<void> {
  if (deleteInFlight) return;
  deleteInFlight = true;
  // ‼️ `finally`다. 취소도, 권한 오류도 잠금을 풀어야 한다 — 풀지 않으면 한 번 취소하거나
  // 한 번 실패한 사용자가 그 세션에서 다시는 지울 수 없다(조용히 먹지 않는 키).
  try {
    const confirmed = await showConfirm(
      ctx.t("tasks.triage.deleteConfirm", { line: task.raw.trimEnd() }),
    );
    if (!confirmed) return;

    await writeAndReconcile(
      task,
      ctx,
      () => applyTaskDelete(task, ctx.editor),
      () => useTaskStore.getState().dropLineFromBuffer(task.path, task.line),
    );
  } finally {
    deleteInFlight = false;
  }
}
