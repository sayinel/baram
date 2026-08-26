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
 */
export async function confirmAndDeleteTaskLine(
  task: TaskEntry,
  ctx: TaskTriageContext,
): Promise<void> {
  const confirmed = await showConfirm(
    ctx.t("tasks.triage.deleteConfirm", { line: task.raw.trim() }),
  );
  if (!confirmed) return;

  await writeAndReconcile(
    task,
    ctx,
    () => applyTaskDelete(task, ctx.editor),
    () => dropTaskLine(task.path, task.line),
  );
}

/**
 * 저장 전 경로의 회계 — 지운 항목을 빼고 그 **아래 줄 번호를 하나씩 올린다**.
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
function dropTaskLine(path: string, line: number): void {
  const { replaceFile, tasks } = useTaskStore.getState();
  replaceFile(
    path,
    tasks
      .filter((x) => x.path === path && x.line !== line)
      .map((x) => (x.line > line ? { ...x, line: x.line - 1 } : x)),
  );
}
