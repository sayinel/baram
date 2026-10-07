import { clearOriginalDoc } from "../../utils/editor/programmatic-update";
// §3.5 닫힌 탭이 쓰던 원문을 내려놓는다 (#798).
//
// 파일을 열면 원문이 `openFiles` 에, 수정 시각이 `fileMtimes` 에, dirty 판정의 기준 문서가
// `originalDocs`(programmatic-update)에 들어간다. 예전에는 탭을 닫아도 이것들이 남아, 한 세션에서
// 열었다 닫은 파일의 크기만큼 메모리가 늘었고, watcher 는 `openFiles` 에 있는 파일을 "열려
// 있다" 고 보므로 닫은 파일이 밖에서 바뀌면 탭도 없는데 다시 읽었다.
//
// 탭을 빼는 close action 은 여럿이다(`closeTab` · `closeOtherTabs` · `closeTabsToRight` ·
// `closeTabsForContexts` · `closeAllTabs`). action 마다 정리를 붙이면 새 action 이 그것을 빠뜨리므로,
// 탭 배열의 변화를 구독해 어느 길로 빠졌든 한 곳에서 내려놓는다.
//
// 기준은 경로가 아니라 **사라진 탭 id** 다. rename 은 탭의 경로를 바꾸지만 원문은
// `renameFileEntry` 가 새 경로로 옮기므로, 경로의 차이로 판정하면 옮기기 전의 원문을 지울 수 있다.
import { useFileStore } from "../file/file";
import { type EditorTab, useEditorStore } from "./editor";

/** `openFiles` 의 key — 제목 없는 탭은 경로가 없어 탭 id 로 들어 있다. */
function contentKey(tab: EditorTab): string {
  return tab.filePath || tab.id;
}

/**
 * `prev` 에 있고 `next` 에 없는 탭의 원문을 내려놓는다. 같은 파일을 보는 탭이 `next` 에 남아
 * 있으면 그 원문은 남긴다.
 */
export function releaseClosedTabs(
  prev: readonly EditorTab[],
  next: readonly EditorTab[],
): void {
  const openIds = new Set(next.map((t) => t.id));
  const closed = prev.filter((t) => !openIds.has(t.id));
  const stillShown = new Set(next.map(contentKey));
  const keys = closed.map(contentKey).filter((k) => !stillShown.has(k));
  useFileStore.getState().releaseFileContents(keys);
  for (const tab of closed) clearOriginalDoc(tab.id);
}

/**
 * 탭 배열의 변화를 구독한다. 돌려준 함수가 구독을 푼다. `useAppStartup` 이 effect 로 시작한다 —
 * `startLastOpenedFileRecorder` 와 같은 이유로, 모듈을 읽을 때가 아니라 앱이 뜰 때.
 */
export function startClosedTabRelease(): () => void {
  return useEditorStore.subscribe((state, prevState) => {
    if (state.tabs !== prevState.tabs) {
      releaseClosedTabs(prevState.tabs, state.tabs);
    }
  });
}
