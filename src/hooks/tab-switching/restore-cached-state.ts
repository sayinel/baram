import type { EditorTab } from "../../stores/editor/editor";
import type { TabSwitchContext } from "./types";
// §298 split-review §2 — original use-tab-switching.ts:410-464.
import type { EditorState } from "@tiptap/pm/state";

import { replaceEditorStateWithVim } from "../../extensions/plugins/vim/replace-editor-state";
import { logCacheEvent, timePhase } from "../../utils/editor/perf-trace";
import { afterDocLoad } from "./after-doc-load";

/**
 * Try cached EditorState first (preserves undo/redo history).
 *
 * Caller (`use-tab-switching.ts`) already dropped a stale cache entry before calling
 * this — see §313 comment there. `cachedState` here is always a live, current-for-this-
 * file EditorState.
 */
export function restoreCachedState(
  ctx: TabSwitchContext,
  activeTabId: string,
  incomingTab: EditorTab,
  content: string,
  cachedState: EditorState,
): void {
  logCacheEvent("hit", activeTabId, cachedState.doc.childCount);
  const cachedScrollTop = ctx.scrollOffsets.current.get(activeTabId);

  // Defer updateState outside React commit phase
  setTimeout(() => {
    timePhase("tabSwitch:restore", () =>
      replaceEditorStateWithVim(ctx.editor.view, cachedState, "cached-restore"),
    );
    ctx.installContent(activeTabId, incomingTab.filePath);
    // §313 ‼️ 복원 **뒤에** 부른다. 이 분기는 캐시된 상태를 이 setTimeout에 미뤄
    // 두므로, 바깥에서 부르면 스크롤 요청이 아직 **나가는** 문서를 보고 좌표를
    // 잡는다 — 들어오는 파일의 줄 번호를 남의 문서에 맞춰 재는 셈이라 커서가
    // 문서 첫머리에 앉았다. cold load 경로(`load-tab-content.ts`의 `finishLoad`)도
    // 문서가 들어온 뒤에 부르므로, 이제 두 분기가 같은 규칙을 지킨다.
    afterDocLoad(ctx, ctx.editor, incomingTab.filePath, content);
  });
  // Restore exact scroll position (not just cursor visibility)
  // §perf-large-file C3.4: scope via editor.view.dom.closest() so this
  // targets the correct editor's scroll container in a dual-editor layout.
  if (cachedScrollTop !== undefined) {
    requestAnimationFrame(() => {
      const scrollContainer = ctx.editor.view.dom.closest<HTMLElement>(
        ".editor-area-scroll",
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = cachedScrollTop;
      }
    });
  } else {
    // No cached scroll — reset to top (avoid stale scroll from previous tab)
    requestAnimationFrame(() => {
      const sc = ctx.editor.view.dom.closest<HTMLElement>(
        ".editor-area-scroll",
      );
      if (sc) sc.scrollTop = 0;
    });
  }
}
