import type { EditorTab } from "../../stores/editor/editor";
import type { TabSwitchContext } from "./types";
// §298 split-review §2 — original use-tab-switching.ts:269-361.
import type { Editor } from "@tiptap/core";

import { dispatchSetSearchTerm } from "../../extensions/plugins/find-replace";
import { activateEditorForDocument } from "../../extensions/plugins/vim/vim-activation";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { patchEditorContent } from "../../utils/editor/patch-editor-content";
import {
  scrollToTarget,
  takePendingScroll,
} from "../../utils/editor/pending-scroll";
import { showConflictModal, triggerAutoReload } from "../use-file-operations";

/**
 * §perf-large-file C3.5: if this tab has a COMPLETE keep-alive editor, show it and
 * skip the load entirely. Caller resolves `incomingKeepaliveEditor` via
 * `keepalive.activeFor(activeTabId)` — `activeFor` returns null for incomplete
 * entries, so reaching this function means the pool already vouches for it.
 */
export function resumeKeepaliveTab(
  ctx: TabSwitchContext,
  activeTabId: string,
  incomingKeepaliveEditor: Editor,
  incomingTab: EditorTab,
): void {
  const { openFiles } = useFileStore.getState();

  // Visibility is controlled by React state (activeKeepaliveEditor) via
  // onActiveEditorChange — no manual DOM style toggle needed.
  ctx.onActiveEditorChange(incomingKeepaliveEditor);
  // §298 D2: this path installs no state, so a half-typed vim command
  // would survive the switch — `d`, leave, return, `w`, and a word the
  // user never asked about disappears.
  activateEditorForDocument(incomingKeepaliveEditor.view);
  // Restore scroll position
  const cachedScrollTop = ctx.scrollOffsets.current.get(activeTabId);
  requestAnimationFrame(() => {
    const scrollContainer =
      incomingKeepaliveEditor.view.dom.closest<HTMLElement>(
        ".editor-area-scroll",
      );
    if (scrollContainer) {
      scrollContainer.scrollTop = cachedScrollTop ?? 0;
    }
  });
  ctx.installContent(activeTabId, incomingTab.filePath);

  // §313 유지 풀의 탭은 캐시가 아니라 **살아 있는 에디터**가 문서를 들고 있다. 그
  // 문서도 배경에 있는 동안 파일이 바뀌면 낡는다 — 아래 mtime 판정은 자동 리로드가
  // 이미 지나간 경우를 잡지 못하므로(두 mtime이 같아진다) 표시를 따로 본다.
  if (
    incomingTab.filePath &&
    useEditorStore.getState().staleContentTabs.includes(activeTabId)
  ) {
    const fresh = openFiles.get(incomingTab.filePath);
    if (fresh !== undefined) {
      patchEditorContent(incomingKeepaliveEditor.view, fresh);
    }
    useEditorStore.getState().clearContentStale(activeTabId);
  }

  // [MINOR-a] Consume pending scroll/search so backlink navigation to a
  // pooled tab scrolls correctly — not just pendingSearchHighlight.
  // §Phase5: Check for keep-alive tab staleness — if the file was modified
  // externally since the last save, handle it before resuming the cached editor.
  if (incomingTab.filePath) {
    const mtimeEntry = useFileStore
      .getState()
      .getFileMtime(incomingTab.filePath);
    if (
      mtimeEntry &&
      mtimeEntry.canReloadMtime > 0 &&
      mtimeEntry.canReloadMtime > mtimeEntry.lastSaveMtime
    ) {
      // activeTabId === incomingTab.id here (see caller), so the incoming
      // tab's dirty state can be read directly.
      const isDirty = incomingTab.isDirty ?? false;
      if (!isDirty) {
        triggerAutoReload(
          incomingTab.filePath,
          mtimeEntry.canReloadMtime,
        ).catch(() => {});
      } else {
        showConflictModal(
          incomingTab.filePath,
          mtimeEntry.canReloadMtime,
          useFileStore.getState().openFiles.get(incomingTab.filePath) ?? "",
        );
        return;
      }
    }
  }
  const kaContent = incomingTab.filePath
    ? openFiles.get(incomingTab.filePath)
    : undefined;
  const pendingHighlight = useUIStore.getState().pendingSearchHighlight;
  // §313 이 탭이 도착했으므로 이 파일 앞으로 온 요청만 소비한다 — 다른 파일을
  // 향한 요청은 여기서 버려진다(`takePendingScroll`).
  const kaTarget = takePendingScroll(incomingTab.filePath);
  if (kaTarget) {
    scrollToTarget(incomingKeepaliveEditor.view, kaContent ?? null, kaTarget);
  }
  if (pendingHighlight) {
    useUIStore.getState().setPendingSearchHighlight(null);
    setTimeout(() => {
      if (incomingKeepaliveEditor.view.isDestroyed) return;
      dispatchSetSearchTerm(incomingKeepaliveEditor.view, pendingHighlight);
      ctx.setFindReplaceOpen(true);
      ctx.setFindReplaceMode("find");
    }, 50);
  }
}
