import type { TabSwitchContext } from "./types";

// §298 split-review §2 — original use-tab-switching.ts:158-234.
import {
  foldPluginKey,
  positionsToAnchors,
} from "../../extensions/plugins/fold";
import { isFileTab, useEditorStore } from "../../stores/editor/editor";
import { useFoldStore } from "../../stores/editor/fold";
import { useFileStore } from "../../stores/file/file";
import { logCacheEvent, timePhase } from "../../utils/editor/perf-trace";
import { isTabLoading } from "../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { isBinaryViewerFile, isMarkdownFile } from "../../utils/file-type";
import { logger } from "../../utils/logger";

/**
 * Save outgoing tab content + cache EditorState (preserves undo history).
 *
 * ‼️ Order contract (§298 split-review §2, 리스크 1): this function reads
 * `isTabLoading(prevTabId)` below. The orchestrator's `cancelInflightAppend()` — which
 * calls `setTabLoading(prevTabId, false)` — MUST run only AFTER this function returns.
 * Reversing that order makes a still-loading document look "safe to cache", and the
 * outgoing-save block below would then persist a partial doc as if it were complete.
 */
export function saveOutgoingTab(
  ctx: TabSwitchContext,
  prevTabId: string,
): void {
  const { tabs } = useEditorStore.getState();
  const prevTab = tabs.find((t) => t.id === prevTabId);

  // §perf-large-file C3.5: determine which editor was active for the outgoing tab
  const prevKeepaliveEditor = ctx.keepalive.get(prevTabId);
  const prevEditor = prevKeepaliveEditor ?? ctx.editor;

  // §perf-large-file C3.5: keep-alive tabs — hide their DOM, skip cache write
  // and skip outgoing serialize. The live editor IS the state; auto-save hooks
  // already run against it continuously.
  if (prevKeepaliveEditor) {
    // Visibility is controlled by React state (activeKeepaliveEditor) —
    // no manual DOM style toggle needed. onActiveEditorChange(null) in the
    // incoming-tab branches hides the keep-alive editor via React render.
    // Don't write editorStateCache or serialize — the editor stays live.
    return;
  }

  if (!isFileTab(prevTab) || !prevEditor) return;

  const prevIsCode = !isMarkdownFile(prevTab?.filePath);
  // §perf-large-file C2: Skip caching/saving a tab that is mid-load —
  // the doc is partial. Returning to it will re-run the uncached open path.
  const prevMidLoad = isTabLoading(prevTabId);
  // Cache EditorState before switching (keeps undo/redo stack intact)
  // Non-MD files don't use ProseMirror — skip caching
  if (!ctx.sourceModeTabs.has(prevTabId) && !prevIsCode && !prevMidLoad) {
    ctx.editorStateCache.current.set(prevTabId, prevEditor.state);
    // §313 방금 쓴 상태가 이 탭의 사실이다 — 이전에 붙어 있던 낡음 표시를 지운다.
    useEditorStore.getState().clearContentStale(prevTabId);
    logCacheEvent("set", prevTabId, prevEditor.state.doc.childCount);
    // Save fold state as content-based anchors
    if (prevTab?.filePath) {
      const pluginState = foldPluginKey.getState(prevEditor.state);
      if (pluginState && pluginState.foldedPositions.size > 0) {
        const anchors = positionsToAnchors(
          prevEditor.state.doc,
          pluginState.foldedPositions,
        );
        useFoldStore.getState().saveFolds(prevTab.filePath, anchors);
      } else if (prevTab?.filePath) {
        useFoldStore.getState().clearFolds(prevTab.filePath);
      }
    }
  }
  // PDF tabs are read-only viewers with no editor — caching the source
  // buffer here would overwrite the "" sentinel with another tab's text
  // under the PDF's path.
  if (
    prevTab?.filePath &&
    !prevMidLoad &&
    !isBinaryViewerFile(prevTab.filePath)
  ) {
    try {
      const md =
        prevIsCode || ctx.sourceModeTabs.has(prevTabId)
          ? ctx.getSourceBuffer(prevTabId)
          : timePhase("tabSwitch:serializeOutgoing", () =>
              serializeLiveDoc(prevEditor),
            );
      useFileStore.getState().setFileContent(prevTab.filePath, md);
    } catch (err) {
      // Serialization failed — mark tab dirty so unsaved edits are visible
      useEditorStore.getState().markDirty(prevTabId, true);
      logger.error("tab-switching: serialization failed for outgoing tab", err);
    }
  }
}
