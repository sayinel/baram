// §305 태스크 쓰기 라우터 — 열린 문서와 디스크 중 어디에 쓸지 한 곳에서 정한다.
//
// 스펙 §18.4는 "ProseMirror 트랜잭션"이라 썼지만 이 코드베이스에는 라이브 Editor가
// 하나뿐이고(App.tsx:394) 비활성 탭은 PM 문서를 갖지 않는다. 또 ✅/📅/⏫는 노드
// 속성이 아니라 문단 텍스트라(task-item.ts:30-34의 유일한 속성은 checked)
// setNodeMarkup만으로는 완료일이 붙지 않는다. 그래서 사이드바가 열린 문서를 고치는
// 기존 관례(PropertiesPanel.tsx:79-91)를 쓴다.

import type { TaskEntry, TaskState } from "../../ipc/types";

import {
  previewTaskFieldLine,
  previewTaskStateLine,
  setTaskField,
  setTaskState,
} from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { isSameLine, lineAt, spliceLine } from "./line-splice";

export type TaskChange =
  | { field: string; kind: "field"; value: string }
  | {
      kind: "state";
      newState: TaskState;
      recordDoneDate: boolean;
      today: string;
    };

export type TaskWriteResult =
  | { kind: "disk"; raw: string }
  | { kind: "document"; raw: string }
  | { kind: "stale" };

/**
 * 태스크 한 줄을 고친다.
 *
 * - `"stale"`은 정상적인 경합이다 — 호출자는 조용히 재인덱싱만 한다.
 * - 그 밖의 실패(권한·디스크)는 **그대로 던진다** — 조용히 삼키면 사용자에게는
 *   원인 모를 죽은 체크박스로만 보인다(M1의 I5).
 */
export async function applyTaskWrite(
  task: TaskEntry,
  change: TaskChange,
): Promise<TaskWriteResult> {
  const tab = useEditorStore
    .getState()
    .tabs.find((t) => t.filePath === task.path);
  const content = tab
    ? useFileStore.getState().openFiles.get(task.path)
    : undefined;

  // 탭이 없거나(닫힌 파일) 내용 캐시가 비어 있으면 디스크가 유일한 진실원이다.
  if (!tab || content === undefined) {
    try {
      return { kind: "disk", raw: await writeToDisk(task, change) };
    } catch (err) {
      // §305 stale은 정상 경합이라 결과값으로 옮긴다. 그 밖의 오류는 호출자에게.
      if (err === "stale") return { kind: "stale" };
      throw err;
    }
  }

  // 열린 문서 경로에는 expected_raw 잠금이 없다 — 같은 판정을 여기서 직접 한다.
  const current = lineAt(content, task.line);
  if (current === null || !isSameLine(current, task.raw)) {
    return { kind: "stale" };
  }

  const updated = await previewLine(current, change);
  const next = spliceLine(content, task.line, updated);
  if (next === null) return { kind: "stale" };

  useFileStore.getState().setFileContent(task.path, next);
  useEditorStore.getState().markDirty(tab.id, true);
  // 활성 탭일 때만 — 다른 탭이 활성인데 새로고침을 요청하면 그 활성 문서를
  // 이 파일의 내용으로 다시 그린다(use-editor-effects.ts:172-192는 activeTabId를 본다).
  if (useEditorStore.getState().activeTabId === tab.id) {
    useEditorStore.getState().requestContentRefresh();
  }
  return { kind: "document", raw: updated };
}

/** 변환 결과 줄만 Rust에서 받아온다 — 변환 로직을 TS에 재구현하지 않는다. */
async function previewLine(raw: string, change: TaskChange): Promise<string> {
  return change.kind === "state"
    ? previewTaskStateLine(
        raw,
        change.newState,
        change.recordDoneDate,
        change.today,
      )
    : previewTaskFieldLine(raw, change.field, change.value);
}

async function writeToDisk(
  task: TaskEntry,
  change: TaskChange,
): Promise<string> {
  return change.kind === "state"
    ? setTaskState(
        task.path,
        task.line,
        task.raw,
        change.newState,
        change.recordDoneDate,
        change.today,
      )
    : setTaskField(task.path, task.line, task.raw, change.field, change.value);
}
