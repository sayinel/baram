// §309 기한 초과 일괄 조정 — 텍스트를 옮기지 않고 기한 필드만 오늘로 민다.
//
// 이 코드베이스에는 트랜잭션 다중 파일 쓰기 원시가 없다. 기존 배치의 표준 형태
// (use-file-tree-crud.ts:69-113의 handleDeleteMany)를 따른다: 항목별 try/catch,
// 누적, 루프가 끝난 뒤 한 번 보고. 항목마다 낙관적 잠금이 걸려 있으므로 부분
// 실패가 파일을 손상시키지는 않는다.
//
// 다만 §305의 라우터는 **한 번에 한 줄**을 쓰도록 설계됐다. 문서 경로는
// `useFileStore`에 쓰고 `requestContentRefresh()`로 키만 올리며, 에디터가 실제로
// 따라잡는 것은 React가 커밋한 뒤다. 루프가 반복 사이에 React에 제어를 넘기지
// 않으므로 반복 N+1이 N 이전의 문서를 읽어 변경 N을 조용히 덮어쓴다. 그래서
// 여기서는 라우팅 대상별로 태스크를 먼저 나누고, 문서 쪽은 문자열 하나에 전부
// 적용한 뒤 **한 번만** 커밋한다.

import type { TaskEntry } from "../../ipc/types";
import type { TaskChange } from "../../utils/tasks/apply-task-write";
import type { Editor } from "@tiptap/react";

import { prosemirrorToMarkdown } from "../../pipeline";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useTaskStore } from "../../stores/tasks/task-store";
import { logger } from "../../utils/logger";
import {
  applyTaskWrite,
  applyToContent,
  isDiskAuthoritative,
  isUnsavedWrite,
  resolveTaskWriteTarget,
} from "../../utils/tasks/apply-task-write";

export interface BulkResult {
  /** 디스크에 쓴 파일 — 호출자가 이만큼만 다시 읽는다 */
  diskPaths: string[];
  /** 오류로 건너뛴 개수 (권한·디스크 등) */
  failed: number;
  /** 그 사이 파일이 바뀌어 거절된 개수 — 오류가 아니라 정상 경합이다 */
  stale: number;
  /** 성공한 개수 */
  updated: number;
}

interface Counts {
  failed: number;
  stale: number;
  updated: number;
}

interface DocumentBatch {
  counts: Counts;
  /** 분류 뒤 문서 경로가 사라져 디스크로 보내야 하는 태스크 */
  fallback: TaskEntry[];
}

/**
 * `tasks`의 기한을 전부 `today`로 세운다. 순차 best-effort.
 *
 * `diskPaths`에는 **디스크에 쓴** 파일만 담긴다. 열린 문서에 쓴 파일은 아직
 * 저장되지 않았으므로 호출자가 다시 읽으면 방금 만든 변경이 되돌아간다 —
 * 그 파일의 태스크는 이 함수가 직접 `patchTask`로 갱신한다(`onToggle`의
 * 문서 경로와 같은 처리).
 */
export async function rescheduleOverdueToToday(
  tasks: TaskEntry[],
  today: string,
  editor: Editor | null,
): Promise<BulkResult> {
  const diskPaths = new Set<string>();
  const counts: Counts = { failed: 0, stale: 0, updated: 0 };

  // 문서 경로는 "활성 + dirty" 탭에서만 성립하고 활성 탭은 하나뿐이므로
  // (그리고 openTab이 filePath로 중복 제거하므로) 한 번의 실행에서 문서로
  // 가는 태스크는 전부 **같은 한 파일**의 것이다.
  const docTasks: TaskEntry[] = [];

  // §312 소스 경로는 여기서 모으지 않는다 — 모아야 했던 이유가 성립하지 않는다.
  // 문서 경로는 `setFileContent` → React 커밋을 거쳐야 다음 읽기에 반영되지만,
  // 소스 버퍼는 ref의 Map이라 쓰기가 **동기적으로** 보인다. 반복 N+1이 N의 결과를
  // 그대로 읽으므로 한 건씩 라우터에 맡기면 된다.
  for (const task of tasks) {
    if (resolveTaskWriteTarget(task.path, editor).kind === "document") {
      docTasks.push(task);
      continue;
    }
    await writeOneToDisk(task, today, editor, diskPaths, counts);
  }

  const doc = await rescheduleInOpenDocument(docTasks, today, editor);
  counts.failed += doc.counts.failed;
  counts.stale += doc.counts.stale;
  counts.updated += doc.counts.updated;

  // 분류와 커밋 사이에 활성 탭이 clean해지면(자동 저장 디바운스 만료·Cmd+S·
  // 탭 전환/닫기) 문서 경로가 사라진다. 디스크 태스크마다 IPC 왕복이 있으므로
  // 그 창은 실제로 넓다. 조용히 버리면 확인 다이얼로그가 약속한 개수와 결과가
  // 어긋나고 사용자에게는 "버튼이 아무 일도 안 한 것"으로 보인다 — 이 작업이
  // 없앤 Major 1과 같은 증상이다. 탭이 clean이면 디스크가 곧 진실원이므로
  // 그리로 보낸다: 쓰기 직전에 라우팅을 판정하던 이 웨이브 이전과 같은 결과다.
  for (const task of doc.fallback) {
    await writeOneToDisk(task, today, editor, diskPaths, counts);
  }

  return {
    diskPaths: [...diskPaths],
    failed: counts.failed,
    stale: counts.stale,
    updated: counts.updated,
  };
}

/**
 * §309 기한 초과를 만든 필드를 그대로 민다 — `due`가 있으면 `due`, 없으면
 * `scheduled`다. 버킷은 `due ?? scheduled`로 판정하므로(task-buckets.ts:78-80)
 * `⏳`만 가진 태스크도 Overdue에 들어오는데, 거기에 무조건 `📅`를 붙이면
 * 사용자가 정한 적 없는 마감이 생기고 한 줄에 모순되는 두 날짜가 남는다.
 */
function changeFor(task: TaskEntry, today: string): TaskChange {
  return { field: task.due ? "due" : "scheduled", kind: "field", value: today };
}

/** 실제로 민 필드만 스토어에 반영한다 — 쓰지 않은 필드를 채우면 파일에 없는 날짜를 주장하게 된다. */
function datePatch(
  task: TaskEntry,
  today: string,
  raw: string,
): Partial<TaskEntry> {
  return task.due ? { due: today, raw } : { raw, scheduled: today };
}

/**
 * 문서 경로 태스크 전부를 **문자열 하나**에 차례로 적용한 뒤 한 번만 커밋한다.
 * 반복마다 `setFileContent`를 부르면 서로를 덮어쓴다(파일 머리말 참조).
 */
async function rescheduleInOpenDocument(
  tasks: TaskEntry[],
  today: string,
  editor: Editor | null,
): Promise<DocumentBatch> {
  const counts: Counts = { failed: 0, stale: 0, updated: 0 };
  const first = tasks[0];
  if (!first) return { counts, fallback: [] };
  // 분류 이후 라우팅이 바뀌었는지 다시 본다. 더는 문서 경로가 아니면 이 태스크들을
  // 버리지 않고 호출자가 디스크로 흘리도록 돌려준다.
  if (!editor) return { counts, fallback: tasks };
  const target = resolveTaskWriteTarget(first.path, editor);
  if (target.kind !== "document") return { counts, fallback: tasks };

  const path = first.path;
  let content = prosemirrorToMarkdown(editor.state.doc);
  const applied: { raw: string; task: TaskEntry }[] = [];

  for (const task of tasks) {
    try {
      // `refresh`를 주지 않는다 — 배치 중에는 누적 문자열이 진실이고 라이브
      // 문서는 React 커밋 전까지 따라오지 않는다(apply-task-write.ts 참조).
      const r = await applyToContent(content, task, changeFor(task, today));
      if (r === null) {
        // 문서 경로의 stale은 `diskPaths`에 넣지 않는다 — 같은 파일을 다시
        // 읽으면 이 배치가 만든 나머지 변경까지 옛 디스크 내용으로 되돌아간다.
        counts.stale += 1;
        continue;
      }
      content = r.content;
      applied.push({ raw: r.raw, task });
      counts.updated += 1;
    } catch (err) {
      logger.error("[tasks] bulk reschedule failed:", task.path, err);
      counts.failed += 1;
    }
  }

  if (applied.length === 0) return { counts, fallback: [] };

  useFileStore.getState().setFileContent(path, content);
  useEditorStore.getState().requestContentRefresh();
  useEditorStore.getState().markDirty(target.tabId, true);
  for (const { raw, task } of applied) {
    useTaskStore
      .getState()
      .patchTask(task.path, task.line, datePatch(task, today, raw));
  }
  return { counts, fallback: [] };
}

/**
 * 디스크 경로 한 건 — `counts`와 `diskPaths`를 제자리에서 갱신한다.
 *
 * 이름과 달리 라우터가 문서·소스(§312) 경로를 고를 수도 있다 — 폴백 직전에 탭이
 * 또 dirty가 됐거나 애초에 소스 모드였을 때다. 그 파일은 `diskPaths`에 넣으면 안
 * 된다 — 저장 전이라 다시 읽으면 방금 만든 변경이 되돌아간다(Major 1). 그때는
 * 스토어를 직접 패치한다.
 */
async function writeOneToDisk(
  task: TaskEntry,
  today: string,
  editor: Editor | null,
  diskPaths: Set<string>,
  counts: Counts,
): Promise<void> {
  try {
    const r = await applyTaskWrite(task, changeFor(task, today), editor);
    if (r.kind === "stale") {
      counts.stale += 1;
      // §312 디스크가 진실원인 경우에만 다시 읽는다. 소스·문서 경로의 stale은 디스크와
      // 무관하므로 그 파일을 다시 읽으면, 같은 배치가 **버퍼에** 이미 만들어 둔 다른
      // 변경까지 옛 디스크 내용으로 되돌아간다 — `rescheduleInOpenDocument`의 stale이
      // `diskPaths`를 건드리지 않는 것과 같은 이유다.
      //
      // ‼️ 어디에 썼는지는 결과가 말한다. 라우터에 다시 물으면 같은 사실의 진실원이
      // 둘이 되고(접근자 미등록이면 `source` 판정도 디스크로 흘러간다) 그 둘이 갈라지는
      // 순간 이 회계가 거짓이 된다.
      if (isDiskAuthoritative(r)) diskPaths.add(task.path);
      return;
    }
    counts.updated += 1;
    if (isUnsavedWrite(r)) {
      useTaskStore
        .getState()
        .patchTask(task.path, task.line, datePatch(task, today, r.raw));
      return;
    }
    diskPaths.add(task.path);
  } catch (err) {
    logger.error("[tasks] bulk reschedule failed:", task.path, err);
    counts.failed += 1;
  }
}
