// §312 줄 삭제의 라우팅 — 디스크·라이브 ProseMirror 문서·소스 버퍼 세 경로 전부.
//
// 어디에 쓸지는 `resolveTaskWriteTarget`이 정한다(규칙의 유일한 정의). 그 세 경로 중
// 하나라도 빠뜨리면 조용히 사라지는 삭제가 된다 — 소스 모드로 열어 둔 파일에서 지운 줄이
// 화면에서만 사라지고 저장하면 되살아나는 식이다.
//
// 편집 쓰기(`applyTaskWrite`)와 나란한 함수를 따로 두는 이유가 둘 있다:
//
// 1. **preview IPC가 없다.** 줄을 지우는 데는 줄 문법 지식이 필요 없어 Rust에 물을 것이
//    없다(상태·필드·태그는 삽입 위치와 공백 규칙 때문에 반드시 물어야 한다). 그래서 저장
//    전 경로가 **동기**다 — 확인과 잘라내기 사이에 await가 없으므로 `applyToContent`가 하는
//    재확인(refresh)이 필요하지 않다. 그 사이에 끼어들 틈 자체가 없다.
// 2. **결과에 "남은 줄"이 없다**(`TaskDeleteResult`).
import type { TaskEntry } from "../../ipc/types";
import type { TaskDeleteResult } from "./apply-task-write";
import type { Editor } from "@tiptap/react";

import { deleteTaskLine } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { linesDescribeUnsavedBuffer } from "../../stores/tasks/task-store";
import { serializeLiveDoc } from "../editor/serialize-live-doc";
import { markSourceTabDirty, resolveTaskWriteTarget } from "./apply-task-write";
import { isSameLine, lineAt, removeLine } from "./line-splice";

/**
 * 태스크 한 줄을 없앤다 — **되돌릴 수 없다**(스냅샷 §71은 파일 단위이고 이 경로를 타지
 * 않는다). 확인 관문은 호출자에게 있다(`confirmAndDeleteTaskLine`); 이 함수는 이미 확인을
 * 받았다고 가정하고 바로 쓴다.
 *
 * - `"stale"`은 정상적인 경합이다 — 그 줄이 우리가 아는 그 줄이 아니면 아무것도 지우지
 *   않는다. 낙관적 잠금이 파괴적 조작에서 갖는 의미가 가장 크다: 잘못된 줄을 지우면
 *   복구할 방법이 없다.
 * - 그 밖의 실패(권한·디스크)는 **그대로 던진다** — 조용히 삼키면 사용자에게는 "먹지 않는
 *   메뉴 항목"으로만 보인다(M1의 I5).
 */
export async function applyTaskDelete(
  task: TaskEntry,
  editor: Editor | null,
): Promise<TaskDeleteResult> {
  const target = resolveTaskWriteTarget(task.path, editor);

  if (target.kind === "source") {
    const result = deleteFromSourceBuffer(task, target.tabId);
    // `null`은 접근자 미등록 — 버퍼를 소유한 `useSourceMode`가 마운트돼 있지 않다는
    // 뜻이다(App 수명). 쓸 버퍼가 존재하지 않으므로 그것이 나중에 디스크를 덮어쓸 일도
    // 없다. 아래 디스크 경로로 흘린다.
    if (result) return result;
  } else if (target.kind === "document" && editor) {
    // `editor` 검사는 라우터가 이미 했지만 TS가 좁혀 주지 않는다.
    return deleteFromDocument(task, editor, target.tabId);
  }

  // §312 편집 쓰기와 같은 관문이다(`applyTaskWrite`의 주석에 이유가 있다). 여기서
  // 어긋난 번호가 통과하면 결과는 잘못된 값이 아니라 **잘못 지워진 줄**이다.
  if (linesDescribeUnsavedBuffer(task.path)) {
    return { kind: "stale", target: "buffer" };
  }

  try {
    await deleteTaskLine(task.path, task.line, task.raw);
    return { kind: "disk" };
  } catch (err) {
    // §305 stale은 정상 경합이라 결과값으로 옮긴다. 그 밖의 오류는 호출자에게.
    if (err === "stale") return { kind: "stale", target: "disk" };
    throw err;
  }
}

/**
 * 그 줄이 **여전히 우리가 아는 그 줄일 때만** 지운다. `null`은 stale.
 *
 * 비교 기준은 `spliceLine` 경로와 같다(`isSameLine`) — 디스크 쪽 `delete_line`이
 * `replace_line`과 같은 기준을 쓰는 것과 같은 이유로, 같은 파일에 대해 두 경로가 서로
 * 다른 것을 stale이라고 부르면 한쪽에서만 지워지는 줄이 생긴다.
 */
function contentWithoutLine(content: string, task: TaskEntry): null | string {
  const current = lineAt(content, task.line);
  if (current === null || !isSameLine(current, task.raw)) return null;
  return removeLine(content, task.line);
}

/** 라이브 ProseMirror 문서 경로 — 화면에 보이는 표면이 WYSIWYG일 때. */
function deleteFromDocument(
  task: TaskEntry,
  editor: Editor,
  tabId: string,
): TaskDeleteResult {
  const next = contentWithoutLine(serializeLiveDoc(editor), task);
  if (next === null) return { kind: "stale", target: "document" };

  useFileStore.getState().setFileContent(task.path, next);
  useEditorStore.getState().requestContentRefresh();
  useEditorStore.getState().markDirty(tabId, true);
  return { kind: "document" };
}

/**
 * 소스 버퍼 경로 — 화면에 보이는 표면이 CodeMirror(원본 마크다운)일 때.
 *
 * `openFiles`도 `requestContentRefresh`도 건드리지 않는다(`writeToSourceBuffer`와 같은
 * 이유): 그 둘은 ProseMirror 표면을 다시 채우는 통로인데 지금 보이는 것은 그 표면이 아니다.
 * `markDirty`는 부른다 — 소스 분기가 clean 탭에도 열리므로, 표시하지 않으면 되돌릴 수 없는
 * 이 변경이 저장하지 않고 닫는 사용자에게 아무 흔적도 남기지 않는다(`markSourceTabDirty`).
 */
function deleteFromSourceBuffer(
  task: TaskEntry,
  tabId: string,
): null | TaskDeleteResult {
  const access = useEditorStore.getState().sourceBufferAccess;
  if (!access) return null;

  const next = contentWithoutLine(access.getSourceBuffer(tabId), task);
  if (next === null) return { kind: "stale", target: "source" };

  access.setSourceBuffer(tabId, next);
  markSourceTabDirty(tabId);
  return { kind: "source" };
}
