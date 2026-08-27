// §309 "기한 초과 전부 오늘로" 액션 — 확인 게이트, 재진입 방지, 결과 보고.
// TaskAgendaPanel에서 뽑아 뒀다(패널이 ~300줄 가이드라인 위에 있었다).
import { useCallback, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { BulkResult } from "./task-bulk-actions";
import type { Editor } from "@tiptap/react";

import { refreshFileTasks } from "../../stores/tasks/task-store";
import { showAlert, showConfirm } from "../../utils/confirm-dialog";
import { rescheduleOverdueToToday } from "./task-bulk-actions";

export interface RescheduleOverdue {
  /** 실행 중 — 호출자가 버튼을 잠근다 */
  busy: boolean;
  run: () => Promise<void>;
}

export interface RescheduleOverdueOptions {
  editor: Editor | null;
  exclude: string[];
  rootPath: null | string;
  tasks: TaskEntry[];
  today: string;
}

export function useRescheduleOverdue({
  editor,
  exclude,
  rootPath,
  tasks,
  today,
}: RescheduleOverdueOptions): RescheduleOverdue {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    // 실행 중 재클릭을 버튼의 `disabled`에만 맡기지 않는다 — 두 번째 루프가
    // 시작되면 문서 경로에서 두 배치가 서로의 누적 문자열을 덮어쓴다.
    if (tasks.length === 0 || busy) return;

    setBusy(true);
    try {
      // §309 파일을 대량 수정하는 동작이므로 자동 실행하지 않는다.
      //
      // ‼️ 아카이브(§312)와 같은 이유로 버튼 문구를 준다 — 기본값은 "Delete"다.
      // 날짜만 미는 조작에 삭제 버튼을 내밀고 있었다.
      const ok = await showConfirm(
        `Reschedule ${tasks.length} overdue task(s) to today?`,
        { confirmLabel: "Reschedule", danger: false },
      );
      if (!ok) return;

      const r = await rescheduleOverdueToToday(tasks, today, editor);
      // 열린 문서에 쓴 파일은 `diskPaths`에 없다 — 아직 저장 전이라 다시 읽으면
      // 방금 만든 변경이 옛 디스크 내용으로 되돌아간다(onToggle의 문서 경로와
      // 같은 이유). 그 파일의 태스크는 rescheduleOverdueToToday가 직접 패치한다.
      for (const path of r.diskPaths) {
        await refreshFileTasks(path, rootPath, exclude);
      }
      await report(r);
    } finally {
      setBusy(false);
    }
  }, [busy, editor, exclude, rootPath, tasks, today]);

  return { busy, run };
}

/**
 * `failed`는 오류, `stale`은 정상 경합이다 — 한 문장으로 뭉뚱그리면 흔한
 * 경합이 사고처럼 보인다. 다만 전부 stale인 실행이 아무 말 없이 끝나면
 * 사용자에게는 버튼이 죽은 것으로 보이므로 그 경우에도 반드시 알린다.
 */
async function report(r: BulkResult): Promise<void> {
  const skipped =
    r.stale > 0 ? `${r.stale} task(s) changed elsewhere and were skipped.` : "";
  if (r.failed > 0) {
    const tail = skipped ? ` ${skipped}` : "";
    await showAlert(
      `Couldn't reschedule ${r.failed} task(s). See the log.${tail}`,
    );
  } else if (skipped) {
    await showAlert(skipped);
  }
}
