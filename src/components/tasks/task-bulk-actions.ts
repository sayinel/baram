// §309 기한 초과 일괄 조정 — 텍스트를 옮기지 않고 기한 필드만 오늘로 민다.
//
// 이 코드베이스에는 트랜잭션 다중 파일 쓰기 원시가 없다. 기존 배치의 표준 형태
// (use-file-tree-crud.ts:69-113의 handleDeleteMany)를 따른다: 항목별 try/catch,
// 누적, 루프가 끝난 뒤 한 번 보고. 항목마다 낙관적 잠금이 걸려 있으므로 부분
// 실패가 파일을 손상시키지는 않는다.

import type { TaskEntry } from "../../ipc/types";
import type { Editor } from "@tiptap/react";

import { logger } from "../../utils/logger";
import { applyTaskWrite } from "../../utils/tasks/apply-task-write";

export interface BulkResult {
  /** 오류로 건너뛴 개수 (권한·디스크 등) */
  failed: number;
  /** 그 사이 파일이 바뀌어 거절된 개수 — 오류가 아니라 정상 경합이다 */
  stale: number;
  /** 실제로 쓴 파일 경로(중복 없음) — 호출자가 이만큼만 다시 읽으면 된다 */
  touchedPaths: string[];
  /** 성공한 개수 */
  updated: number;
}

/**
 * `tasks`의 기한을 전부 `today`로 세운다. 순차 best-effort.
 *
 * `editor`는 그대로 `applyTaskWrite`에 전달된다 — 열린 문서 경로가 라이브
 * ProseMirror 문서에서 읽고 써야 하기 때문이다(apply-task-write.ts 참조).
 */
export async function rescheduleOverdueToToday(
  tasks: TaskEntry[],
  today: string,
  editor: Editor | null,
): Promise<BulkResult> {
  const touched = new Set<string>();
  let updated = 0;
  let stale = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      const r = await applyTaskWrite(
        task,
        {
          field: "due",
          kind: "field",
          value: today,
        },
        editor,
      );
      if (r.kind === "stale") {
        stale += 1;
      } else {
        updated += 1;
      }
      // stale도 그 파일을 다시 읽어야 옳은 상태가 보인다.
      touched.add(task.path);
    } catch (err) {
      logger.error("[tasks] bulk reschedule failed:", task.path, err);
      failed += 1;
    }
  }

  return { failed, stale, touchedPaths: [...touched], updated };
}
