// §305 태스크 쓰기 라우터 — 열린 문서와 디스크 중 어디에 쓸지 한 곳에서 정한다.
//
// 초판은 "탭이 열려 있으면 openFiles에 쓴다"였지만 openFiles는 라이브 문서의
// 거울이 아니다 — 마크다운 자동 저장(use-auto-save.ts:96-101)은 writeFile +
// markDirty(false)만 하고 setFileContent를 부르지 않으므로, 사용자가 타이핑을
// 시작한 순간부터 openFiles는 영원히 낡는다. 거기에 스플라이스해 넣고
// requestContentRefresh를 부르면 방금 친 내용을 화면과 디스크 양쪽에서
// 지워버린다. 그래서 문서 경로는 라이브 ProseMirror 문서에서 직접 읽고 쓴다.

import type { TaskEntry, TaskState } from "../../ipc/types";
import type { Editor } from "@tiptap/react";

import {
  previewTaskFieldLine,
  previewTaskStateLine,
  setTaskField,
  setTaskState,
} from "../../ipc/invoke";
import { prosemirrorToMarkdown } from "../../pipeline";
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

export type TaskWriteTarget =
  { kind: "disk" } | { kind: "document"; tabId: string };

/**
 * 태스크 한 줄을 고친다.
 *
 * - `"stale"`은 정상적인 경합이다 — 호출자는 조용히 재인덱싱만 한다.
 * - 그 밖의 실패(권한·디스크)는 **그대로 던진다** — 조용히 삼키면 사용자에게는
 *   원인 모를 죽은 체크박스로만 보인다(M1의 I5).
 *
 * `editor`는 활성 탭의 라이브 Tiptap Editor(없으면 `null`) — 문서 경로가
 * 유일하게 안전한 "활성 + dirty" 조건을 판정하고, 그 조건일 때 실제로 읽고
 * 쓸 라이브 문서를 얻는 데 쓴다.
 */
export async function applyTaskWrite(
  task: TaskEntry,
  change: TaskChange,
  editor: Editor | null,
): Promise<TaskWriteResult> {
  const target = resolveTaskWriteTarget(task.path, editor);
  // `editor` 검사는 라우터가 이미 했지만 TS가 좁혀 주지 않는다 — 런타임에는
  // 도달 불가한 분기다.
  if (target.kind === "disk" || !editor) {
    try {
      return { kind: "disk", raw: await writeToDisk(task, change) };
    } catch (err) {
      // §305 stale은 정상 경합이라 결과값으로 옮긴다. 그 밖의 오류는 호출자에게.
      if (err === "stale") return { kind: "stale" };
      throw err;
    }
  }

  const applied = await applyToContent(
    prosemirrorToMarkdown(editor.state.doc),
    task,
    change,
    () => prosemirrorToMarkdown(editor.state.doc),
  );
  if (applied === null) return { kind: "stale" };

  useFileStore.getState().setFileContent(task.path, applied.content);
  useEditorStore.getState().requestContentRefresh();
  useEditorStore.getState().markDirty(target.tabId, true);
  return { kind: "document", raw: applied.raw };
}

/**
 * 문서 경로의 순수 부분 — 문자열을 받아 갱신된 문자열을 돌려준다. 스토어를
 * 건드리지 않는다. `null`은 stale(낙관적 잠금 거절)이다.
 *
 * `refresh`를 주면 preview await 뒤에 그것으로 내용을 다시 읽어 재확인한다.
 * 단건 경로(`applyTaskWrite`)가 그렇게 한다 — await 동안 외부 리로드
 * (triggerAutoReload)나 PropertiesPanel 같은 다른 패널의 편집이 같은 파일에
 * 끼어들 수 있고, await 전에 잡아둔 문서로 스플라이스하면 그 변경을 조용히
 * 덮어쓰기 때문이다.
 *
 * 일괄 경로는 **일부러 주지 않는다**. 배치 중에는 자기 누적 문자열이 진실이고
 * (라이브 문서는 React가 커밋할 때까지 따라오지 않는다) 한 번의 사용자 제스처
 * 안이라 중간에 다른 편집이 끼어들 여지도 없다.
 */
export async function applyToContent(
  content: string,
  task: TaskEntry,
  change: TaskChange,
  refresh?: () => string,
): Promise<null | { content: string; raw: string }> {
  const current = lineAt(content, task.line);
  if (current === null || !isSameLine(current, task.raw)) return null;

  const updated = await previewLine(current, change);

  const contentAfter = refresh ? refresh() : content;
  const currentAfter = lineAt(contentAfter, task.line);
  if (currentAfter === null || !isSameLine(currentAfter, task.raw)) return null;

  const next = spliceLine(contentAfter, task.line, updated);
  if (next === null) return null;
  return { content: next, raw: updated };
}

/**
 * 이 파일이 어디에 써야 하는지 판정한다 — 라우팅 규칙의 **유일한** 정의다.
 * §309 일괄 경로도 이것을 불러 태스크를 분류하므로, 규칙을 두 벌로 두면
 * 반드시 드리프트한다.
 *
 * 문서 경로는 "활성 + dirty" 탭에서만 안전하다. 그 밖의 모든 경우는 디스크로:
 * - 탭이 없다(닫힌 파일) → 디스크가 유일한 진실원.
 * - 배경 탭 → openFiles에 써도 나중에 그 탭으로 돌아오면 캐시된 PM 상태가
 *   덮어쓴다(use-tab-switching.ts:461-494는 openFiles가 아니라
 *   editorStateCache를 복원한다) — 방금 만든 변경이 사라지고 탭만 거짓으로
 *   dirty가 된다.
 * - 활성이지만 clean → 버퍼와 디스크가 이미 같으므로 디스크에 써도 잃는 게
 *   없고, non-dirty 탭의 외부 변경 자동 리로드(use-file-operations.ts의
 *   triggerAutoReload)가 에디터를 알아서 갱신한다.
 * - editor가 없다 → 문서를 읽을 방법이 없다.
 */
export function resolveTaskWriteTarget(
  path: string,
  editor: Editor | null,
): TaskWriteTarget {
  const { activeTabId, tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.filePath === path);
  if (!tab || tab.id !== activeTabId || !tab.isDirty || !editor) {
    return { kind: "disk" };
  }
  return { kind: "document", tabId: tab.id };
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
