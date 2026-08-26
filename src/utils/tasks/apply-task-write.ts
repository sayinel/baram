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
  previewTaskTagLine,
  setTaskField,
  setTaskState,
  setTaskTag,
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
    }
  /**
   * §312 태그 토글. `set_task_field`에 끼워 넣을 수 없다 — `FIELD_EMOJI`는 날짜 여섯뿐이고
   * `apply_field`는 모르는 이름을 파일을 건드리기 전에 거절한다(write.rs:194). 삽입 위치도
   * 다르다: 필드는 줄 끝, 태그는 §303 순서상 이모지 필드 **앞**이다.
   */
  | { kind: "tag"; on: boolean; tag: string };

/**
 * §312 삭제 결과. 편집 결과(`TaskWriteResult`)와 갈라지는 지점이 정확히 하나 있다:
 * **"그 자리에 남은 줄"이 없다.** 그래서 `raw`를 갖지 않는다 — 빈 문자열이라도 넣어 두면
 * 호출자가 그것을 새 줄인 줄 알고 스토어에 밀어 넣을 수 있고, 저장 전 분기가 하는 일이
 * 정확히 그것이다(`writeAndReconcile`).
 *
 * `kind`의 어휘는 같으므로 `isUnsavedWrite`·`isDiskAuthoritative`가 두 타입을 함께 받는다 —
 * 세 갈래 회계를 두 벌로 만들지 않으려면 그 술어가 하나여야 한다.
 */
export type TaskDeleteResult =
  | { kind: "disk" }
  | { kind: "document" }
  | { kind: "source" }
  | { kind: "stale"; target: "disk" | "document" | "source" };

export type TaskWriteResult =
  | { kind: "disk"; raw: string }
  | { kind: "document"; raw: string }
  | { kind: "source"; raw: string }
  /**
   * 낙관적 잠금 거절. `target`은 쓰기를 **실제로 시도한 곳**이다 — 라우터가 고른 곳이
   * 아니다(접근자가 없으면 `source` 판정도 디스크로 흘러간다). 호출자의 회계는 이 값만
   * 봐야 한다: 라우터에 다시 물으면 같은 사실에 두 개의 진실원이 생기고, 그것이 갈라지는
   * 순간 쓰지도 않은 파일을 다시 읽어 같은 배치가 버퍼에 만들어 둔 변경을 되돌린다.
   */
  | { kind: "stale"; target: "disk" | "document" | "source" };

export type TaskWriteTarget =
  | { kind: "disk" }
  | { kind: "document"; tabId: string }
  | { kind: "source"; tabId: string };

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

  if (target.kind === "source") {
    const result = await writeToSourceBuffer(task, change, target.tabId);
    // `null`은 접근자 미등록이다 — 표면 하나가 아니라 버퍼를 소유한 `useSourceMode`
    // 자체가 마운트돼 있지 않다는 뜻이다(App 수명). 쓸 버퍼가 존재하지 않으므로 그것이
    // 나중에 디스크를 덮어쓸 일도 없다. 아래 디스크 경로로 흘린다.
    if (result) return result;
  } else if (target.kind === "document" && editor) {
    // `editor` 검사는 라우터가 이미 했지만 TS가 좁혀 주지 않는다 — 런타임에는
    // 거짓이 될 수 없는 조건이다.
    return await writeToDocument(task, change, editor, target.tabId);
  }

  try {
    return { kind: "disk", raw: await writeToDisk(task, change) };
  } catch (err) {
    // §305 stale은 정상 경합이라 결과값으로 옮긴다. 그 밖의 오류는 호출자에게.
    if (err === "stale") return { kind: "stale", target: "disk" };
    throw err;
  }
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
 * 이 파일을 **디스크에서 다시 읽어도 되는가**.
 *
 * `isUnsavedWrite`와 갈라지는 지점이 정확히 하나 있다: 소스·문서 경로의 `stale`이다.
 * 아무것도 쓰이지 않았으니 스토어에 패치할 `raw`가 없고(그래서 `isUnsavedWrite`는 거짓이다),
 * 그렇다고 디스크가 진실원인 것도 아니다 — 그 파일의 진실은 아직 저장되지 않은 버퍼이고,
 * 다시 읽으면 같은 세션이 그 버퍼에 이미 만들어 둔 **다른 줄의 변경**까지 옛 디스크
 * 내용으로 되돌아간다. 두 술어를 하나로 합칠 수 없는 이유가 이것이다: 하나는 "패치할
 * 값을 들고 있는가", 다른 하나는 "다시 읽어도 되는가"이고 세 번째 경우에서 답이 다르다.
 *
 * `null`(쓰기가 예외로 실패)은 참이다 — 무엇이 남았는지 알 수 없으니 디스크를 다시 읽어
 * 스토어를 사실과 맞추는 것이 맞다.
 */
export function isDiskAuthoritative(
  result: null | TaskDeleteResult | TaskWriteResult,
): boolean {
  if (result === null) return true;
  if (result.kind === "stale") return result.target === "disk";
  return result.kind === "disk";
}

/**
 * 이 결과가 **아직 디스크에 없는가**. 호출자는 그때 파일을 다시 읽으면 안 되고
 * (읽으면 방금 만든 변경이 되돌아간다) 태스크 스토어를 직접 패치해야 한다.
 *
 * 술어로 뽑아 두는 이유: in-memory 경로가 하나(`document`)에서 둘(`source`)이 됐고,
 * 호출자마다 `kind === "document"`를 손으로 늘려 가면 하나를 빠뜨리는 순간 그 경로의
 * 변경이 조용히 사라진다.
 *
 * 제네릭인 이유: §312 삭제 결과에는 `raw`가 없다(`TaskDeleteResult`). 반환 타입을
 * `raw`를 가진 형태로 고정해 두면 삭제는 이 술어를 쓸 수 없고, 그러면 세 갈래 회계가
 * 두 벌이 된다. 넘긴 타입에서 그대로 좁혀 주므로 편집 경로는 여전히 `raw`를 본다.
 */
export function isUnsavedWrite<R extends TaskDeleteResult | TaskWriteResult>(
  result: null | R,
): result is Extract<R, { kind: "document" | "source" }> {
  return result?.kind === "document" || result?.kind === "source";
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
 *
 * §312 그 안에서 다시 갈린다: 탭이 소스 모드면 사용자가 보고 있는 권위 있는 텍스트는
 * ProseMirror 문서가 아니라 소스 버퍼다. 그리로 보낸다.
 */
export function resolveTaskWriteTarget(
  path: string,
  editor: Editor | null,
): TaskWriteTarget {
  const { activeTabId, sourceModeTabs, tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.filePath === path);
  if (!tab || tab.id !== activeTabId || !tab.isDirty || !editor) {
    return { kind: "disk" };
  }
  // ‼️ 이 검사는 document 판정 **앞**에 있어야 한다. 소스 모드인 더티 활성 탭은
  // document 조건을 전부 만족하는 부분집합이라, 뒤로 옮기면 영원히 도달하지 못한다.
  if (sourceModeTabs.includes(tab.id)) return { kind: "source", tabId: tab.id };
  return { kind: "document", tabId: tab.id };
}

/** 변환 결과 줄만 Rust에서 받아온다 — 변환 로직을 TS에 재구현하지 않는다. */
async function previewLine(raw: string, change: TaskChange): Promise<string> {
  switch (change.kind) {
    case "field":
      return previewTaskFieldLine(raw, change.field, change.value);
    case "state":
      return previewTaskStateLine(
        raw,
        change.newState,
        change.recordDoneDate,
        change.today,
      );
    case "tag":
      return previewTaskTagLine(raw, change.tag, change.on);
  }
}

async function writeToDisk(
  task: TaskEntry,
  change: TaskChange,
): Promise<string> {
  switch (change.kind) {
    case "field":
      return setTaskField(
        task.path,
        task.line,
        task.raw,
        change.field,
        change.value,
      );
    case "state":
      return setTaskState(
        task.path,
        task.line,
        task.raw,
        change.newState,
        change.recordDoneDate,
        change.today,
      );
    case "tag":
      return setTaskTag(task.path, task.line, task.raw, change.tag, change.on);
  }
}

/** 라이브 ProseMirror 문서 경로 — 화면에 보이는 표면이 WYSIWYG일 때. */
async function writeToDocument(
  task: TaskEntry,
  change: TaskChange,
  editor: Editor,
  tabId: string,
): Promise<TaskWriteResult> {
  const applied = await applyToContent(
    prosemirrorToMarkdown(editor.state.doc),
    task,
    change,
    () => prosemirrorToMarkdown(editor.state.doc),
  );
  if (applied === null) return { kind: "stale", target: "document" };

  useFileStore.getState().setFileContent(task.path, applied.content);
  useEditorStore.getState().requestContentRefresh();
  useEditorStore.getState().markDirty(tabId, true);
  return { kind: "document", raw: applied.raw };
}

/**
 * §312 소스 버퍼 경로 — 화면에 보이는 표면이 CodeMirror(원본 마크다운)일 때.
 *
 * 버퍼는 이미 마크다운 문자열이라 `applyToContent`/`spliceLine`을 그대로 재사용한다.
 * 줄바꿈 스타일과 끝 개행 유무가 디스크 경로와 바이트 단위로 같은 것도 그 덕이다.
 *
 * `refresh`를 주는 이유는 단건 문서 경로와 같다 — preview IPC를 기다리는 사이
 * CodeMirror의 `onChange`가 버퍼를 통째로 갈아끼울 수 있고, await 전에 잡아둔
 * 문자열로 스플라이스하면 사용자가 방금 친 글자가 사라진다.
 *
 * `openFiles`도 `requestContentRefresh`도 건드리지 않는다. 그 둘은 ProseMirror 표면을
 * 다시 채우는 통로인데 지금 보이는 것은 그 표면이 아니다 — 새로고침을 요청하면 숨어
 * 있는 문서만 흔들고 정작 화면은 그대로다. 저장 경로(`use-file-operations.ts:169`)도
 * 소스 모드 탭에서는 `openFiles`가 아니라 이 버퍼를 읽는다.
 *
 * `null`은 "접근자 미등록" — 이 파일의 표면 하나가 아니라 버퍼를 소유한
 * `useSourceMode`(App 수명)가 통째로 마운트돼 있지 않다는 뜻이다. 쓸 버퍼가 아예 없으므로
 * 호출자가 디스크로 폴백한다. `{kind:"stale"}`(경합)과는 다른 신호다.
 */
async function writeToSourceBuffer(
  task: TaskEntry,
  change: TaskChange,
  tabId: string,
): Promise<null | TaskWriteResult> {
  const access = useEditorStore.getState().sourceBufferAccess;
  if (!access) return null;

  const applied = await applyToContent(
    access.getSourceBuffer(tabId),
    task,
    change,
    () => access.getSourceBuffer(tabId),
  );
  if (applied === null) return { kind: "stale", target: "source" };

  // markDirty를 부르지 않는다 — 이 경로에 오려면 탭이 이미 dirty여야 하고
  // (resolveTaskWriteTarget의 전제), markDirty는 tabs 배열을 새로 만들어
  // 모든 구독자를 깨우므로 순수한 낭비다.
  access.setSourceBuffer(tabId, applied.content);
  return { kind: "source", raw: applied.raw };
}
