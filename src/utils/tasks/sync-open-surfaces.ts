// §313 디스크에 쓴 한 줄을 **그 파일을 열어 둔 표면들**에도 곧바로 반영한다.
//
// 이것이 없었을 때의 설계는 "탭이 활성 + clean이면 디스크에 쓰고, 비-dirty 탭의 외부
// 변경 자동 리로드가 에디터를 알아서 갱신한다"였다(`apply-task-write.ts`의 라우터 주석).
// 그 문장의 대가가 컸다: 사이드바에서 체크박스를 누른 결과가 **OS 워처를 한 바퀴 돌아야만**
// 화면에 도착하고, 워처가 조용하거나 늦으면 화면과 파일이 갈라진 채로 남는다.
//
// 이제 워처 왕복은 안전망이지 통로가 아니다. 쓰기가 성공한 그 자리에서 열린 표면을 맞추고,
// 뒤따라 도착하는 앱-출처(`origin: "app"`) 이벤트는 이미 같은 내용을 보므로 아무 일도
// 하지 않는다(`patchEditorContent`가 동일한 내용에는 트랜잭션을 보내지 않는다).
//
// ‼️ 표면마다 **자기 텍스트를 기준으로** 스플라이스한다. 한 표면의 문자열을 다른 표면에
// 밀어 넣으면, 둘이 이미 갈라져 있던 경우 이 조작과 아무 상관 없는 차이까지 함께 덮어쓴다.
// 낙관적 잠금(`isSameLine`)도 표면마다 따로 건다 — 맞지 않으면 그 표면은 건드리지 않고
// 조용히 지나간다. 워처의 앱-출처 리로드가 디스크에서 다시 읽어 마무리한다.

import type { TaskEntry } from "../../ipc/types";
import type { Editor } from "@tiptap/react";

import { prosemirrorToMarkdown } from "../../pipeline";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { patchEditorContent } from "../editor/patch-editor-content";
import { isSameLine, lineAt, spliceLine } from "./line-splice";

/**
 * `task.line`이 `newRaw`가 됐다는 사실을 열린 표면들에 반영한다.
 *
 * - `openFiles` 캐시 — 탭을 다시 여는 경로와 읽기 전용 패널들이 읽는다.
 * - 활성 WYSIWYG 탭의 라이브 문서 — 사용자가 지금 보고 있는 것.
 * - 배경 탭 — 캐시된 ProseMirror 상태에 낡음 표시를 달아, 돌아왔을 때 그 캐시가 아니라
 *   방금 갱신한 `openFiles`를 다시 읽게 한다.
 *
 * ‼️ dirty 탭에는 낡음 표시를 달지 않는다. 그 캐시는 아직 저장되지 않은 편집을 들고 있고,
 * 표시를 달면 탭 전환이 그것을 버린다 — 이 조작이 고치려던 것보다 나쁜 손실이다.
 */
export function syncOpenSurfacesAfterDiskWrite(
  task: TaskEntry,
  newRaw: string,
  editor: Editor | null,
): void {
  const { activeTabId, markContentStale, sourceModeTabs, tabs } =
    useEditorStore.getState();

  patchCachedContent(task, newRaw);

  for (const tab of tabs) {
    if (tab.filePath !== task.path) continue;
    // 소스 모드 탭의 권위 있는 텍스트는 CodeMirror 버퍼다. 여기까지 흘러왔다는 것은
    // 그 버퍼의 접근자가 아예 등록돼 있지 않다는 뜻이므로(라우터 주석) 쓸 버퍼가 없다.
    if (sourceModeTabs.includes(tab.id)) continue;

    if (tab.id === activeTabId && editor?.view) {
      patchLiveDocument(task, newRaw, editor);
    } else if (!tab.isDirty) {
      markContentStale(tab.id);
    }
  }
}

/**
 * §312 파일 **전체**가 디스크에서 바뀌었다는 사실을 열린 표면들에 반영한다.
 *
 * 아카이브는 한 파일에서 여러 줄을 한 번에 빼내므로 위의 줄 단위 동기화로는 표현할 수
 * 없다. 그러나 성질은 같다 — **디스크가 이미 진실이고 화면이 따라가는 것**이다. 그래서
 * 같은 도구를 쓴다: `patchEditorContent`가 `CONTENT_SYNC_META`를 달아 보내므로 자동
 * 저장이 이 변경을 사용자 편집으로 오해하지 않는다.
 *
 * ‼️ `requestContentRefresh`를 쓰면 안 된다. 그것은 "우리가 문서를 고쳤다"는 경로
 * (`applyTaskWrite`의 문서 분기)의 도구라 그 보호가 없다. 아카이브가 그것을 쓰는 동안
 * 탭에 저장 안 됨 표시가 붙고, 자동 저장이 방금 아카이브가 쓴 파일 위에 에디터의
 * 직렬화 결과를 덮어썼다 — `use-auto-save.ts`의 `CONTENT_SYNC_META` 분기가 막으려고
 * 존재하는 바로 그 일이다.
 *
 * dirty 탭은 건너뛴다. 그 캐시는 저장되지 않은 편집을 들고 있고, 낡음 표시를 달면 탭
 * 전환이 그것을 버린다 — 위 함수와 같은 이유다. 아카이브는 애초에 dirty 탭이 있으면
 * 시작하지 않지만(`findBlockingTab`), 판정과 쓰기 사이에 탭이 dirty가 될 수는 있다.
 */
export function syncOpenSurfacesAfterFileRewrite(
  path: string,
  content: string,
  editor: Editor | null,
): void {
  const { activeTabId, markContentStale, sourceModeTabs, tabs } =
    useEditorStore.getState();

  useFileStore.getState().setFileContent(path, content);

  for (const tab of tabs) {
    if (tab.filePath !== path) continue;
    // 소스 모드 탭의 권위 있는 텍스트는 CodeMirror 버퍼다 — 여기서 손댈 것이 없다.
    if (sourceModeTabs.includes(tab.id)) continue;

    if (tab.id === activeTabId && editor?.view) {
      patchEditorContent(editor.view, content);
    } else if (!tab.isDirty) {
      markContentStale(tab.id);
    }
  }
}

/** `openFiles` 스냅샷의 그 줄만. 열려 있지 않거나 이야기가 다르면 손대지 않는다. */
function patchCachedContent(task: TaskEntry, newRaw: string): void {
  const cached = useFileStore.getState().openFiles.get(task.path);
  if (cached === undefined) return;
  const next = spliceMatchingLine(cached, task, newRaw);
  if (next === null) return;
  useFileStore.getState().setFileContent(task.path, next);
}

/** 화면의 문서 — 자기 마크다운을 기준으로 스플라이스한 뒤 트랜잭션 하나로 맞춘다. */
function patchLiveDocument(
  task: TaskEntry,
  newRaw: string,
  editor: Editor,
): void {
  const next = spliceMatchingLine(
    prosemirrorToMarkdown(editor.state.doc),
    task,
    newRaw,
  );
  if (next === null) return;
  patchEditorContent(editor.view, next);
}

/** 그 줄이 아직 우리가 본 그 줄일 때만 갈아끼운다 — 아니면 `null`. */
function spliceMatchingLine(
  content: string,
  task: TaskEntry,
  newRaw: string,
): null | string {
  const current = lineAt(content, task.line);
  if (current === null || !isSameLine(current, task.raw)) return null;
  return spliceLine(content, task.line, newRaw);
}
