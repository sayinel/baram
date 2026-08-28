import type { EditorTab } from "../../stores/editor/editor";
import type { TabSwitchContext } from "./types";

// §298 split-review §2 — original use-tab-switching.ts:465-621.
import { EditorState, TextSelection } from "@tiptap/pm/state";

import {
  anchorsToPositions,
  dispatchRestoreFolds,
} from "../../extensions/plugins/fold";
import { replaceEditorStateWithVim } from "../../extensions/plugins/vim/replace-editor-state";
import { mdastBlocksToPmNodes } from "../../pipeline/md-to-pm";
import { parseMdastAsync } from "../../pipeline/parse-async";
import { useEditorStore } from "../../stores/editor/editor";
import { useFoldStore } from "../../stores/editor/fold";
import { logCacheEvent, timePhase } from "../../utils/editor/perf-trace";
import { setTabLoading } from "../../utils/editor/programmatic-update";
import {
  appendChunksProgressively,
  chunkBlocks,
  FIRST_CHUNK_BLOCKS,
  REST_CHUNK_BLOCKS,
} from "../../utils/editor/progressive-load";
import { logger } from "../../utils/logger";
import { LARGE_DOC_BLOCK_THRESHOLD } from "../use-large-doc-keepalive";
import { afterDocLoad } from "./after-doc-load";

/**
 * Cold load — no cached EditorState. §perf-large-file B1/C2: parse in a Worker,
 * progressively render chunks. Rendering perf is handled by content-visibility: auto (C1).
 */
export function loadTabContent(
  ctx: TabSwitchContext,
  activeTabId: string,
  incomingTab: EditorTab,
  content: string,
): void {
  logCacheEvent("miss", activeTabId);
  ctx.progressiveLoadRef.current.cancelled = true;
  const loadToken = { cancelled: false };
  ctx.progressiveLoadRef.current = loadToken;
  ctx.setIsParsing(true);

  parseMdastAsync(content)
    .then((mdast) => {
      if (loadToken.cancelled) {
        ctx.setIsParsing(false);
        return;
      }
      if (useEditorStore.getState().activeTabId !== activeTabId) {
        ctx.setIsParsing(false);
        return;
      }

      const allNodes = timePhase("convert(mdast→PM)", () =>
        mdastBlocksToPmNodes(mdast, ctx.editor.schema),
      );

      // §perf-large-file C3.5: decide up-front whether to load into a
      // keep-alive editor (direct-load variant — simpler to verify).
      const isLargeDoc = allNodes.length >= LARGE_DOC_BLOCK_THRESHOLD;
      let targetEditor = ctx.editor;
      if (isLargeDoc && !ctx.keepalive.has(activeTabId)) {
        targetEditor = ctx.createKeepaliveEditor();
        // [MAJOR-5] Acquire the pool slot immediately so a mid-load
        // switch-away destroys it via cancelInflightAppend + pool cleanup
        // instead of leaking a detached editor forever.
        ctx.keepalive.acquire(activeTabId, targetEditor);
        ctx.onActiveEditorChange(targetEditor);
      }

      // §perf-large-file C3: the keep-alive editor is a SEPARATE Editor
      // instance with its OWN Schema. ProseMirror compares NodeTypes by
      // identity, so nodes built with `editor.schema` are foreign to the
      // keep-alive editor — its `doc.contentMatchAt` rejects them ("Called
      // contentMatchAt on a node with invalid content"), which throws on
      // the first progressive append and truncates the document to the
      // first chunk. Re-convert against the target editor's schema when it
      // differs so every node's NodeType belongs to the right schema.
      const targetNodes =
        targetEditor === ctx.editor
          ? allNodes
          : mdastBlocksToPmNodes(mdast, targetEditor.schema);
      const chunks = chunkBlocks(
        targetNodes,
        FIRST_CHUNK_BLOCKS,
        REST_CHUNK_BLOCKS,
      );
      const firstChunk = chunks[0] ?? [];
      const restChunks = chunks.slice(1);

      const doc = targetEditor.schema.nodes.doc.create(
        null,
        firstChunk.length ? firstChunk : undefined,
      );
      const newState = EditorState.create({
        doc,
        plugins: targetEditor.state.plugins,
        selection: TextSelection.atStart(doc),
      });

      // Suppress dirty/auto-save for the whole progressive load.
      setTabLoading(activeTabId, true);

      // Run the deferred post-load work once the FULL doc is present.
      const finishLoad = () => {
        // Null the ref before clearing the flag so a concurrent cleanup
        // (effect re-run) can't see a stale tabId and clear a newer load's flag.
        // Only null if this load's tabId still matches (no newer load started).
        if (ctx.appendHandleRef.current?.tabId === activeTabId) {
          ctx.appendHandleRef.current = null;
        }
        setTabLoading(activeTabId, false);
        ctx.installContent(activeTabId, incomingTab.filePath);

        // [NEW-CRITICAL-B] Mark the pool entry as complete so
        // switch-back uses it rather than discarding it.
        if (isLargeDoc) {
          ctx.keepalive.markComplete(activeTabId);
        }

        afterDocLoad(ctx, targetEditor, incomingTab.filePath, content);
        // ‼️ One identity for the whole load: install, notify, post-load work, and
        // this fold lookup all use the path this load STARTED with. Re-reading the
        // live tab here would mix identities — a rename during a long progressive
        // append changes `EditorTab.filePath`, but the fold store is still keyed by
        // the old path (nothing rekeys it), so a live read finds no anchors while
        // everything else in this load still ran under the old path.
        if (incomingTab.filePath) {
          const savedAnchors = useFoldStore
            .getState()
            .getFolds(incomingTab.filePath);
          if (savedAnchors.length > 0) {
            const positions = anchorsToPositions(
              targetEditor.view.state.doc,
              savedAnchors,
            );
            if (positions.length > 0) {
              dispatchRestoreFolds(targetEditor.view, positions);
            }
          }
        }
      };

      // Defer updateState outside React commit phase.
      setTimeout(() => {
        if (loadToken.cancelled) {
          setTabLoading(activeTabId, false);
          ctx.setIsParsing(false);
          return;
        }
        timePhase("updateState(first chunk)", () =>
          // §perf-large-file C4: apply with the editor's CURRENT plugins
          // (read at apply time, not the set captured into `newState`).
          // @tiptap/react menus call editor.registerPlugin() via a passive
          // effect between newState capture and this deferred apply, so the
          // captured plugin set is stale; applying it would revert that
          // registration AND drop the ViewportVirtualize plugin — its
          // controller would be destroyed with no live replacement, so
          // large-doc windowing never engages (GUI: hidden=0/all blocks).
          replaceEditorStateWithVim(
            targetEditor.view,
            newState.reconfigure({ plugins: targetEditor.state.plugins }),
            "fresh-document",
          ),
        );
        ctx.setIsParsing(false);

        // Reset scroll to top for freshly opened documents.
        // §perf-large-file C3.4: resolve via targetEditor.view.dom.closest().
        requestAnimationFrame(() => {
          const scrollContainer = targetEditor.view.dom.closest<HTMLElement>(
            ".editor-area-scroll",
          );
          if (scrollContainer) scrollContainer.scrollTop = 0;
        });

        if (restChunks.length === 0) {
          finishLoad();
          return;
        }
        ctx.appendHandleRef.current = {
          handle: appendChunksProgressively(targetEditor, restChunks, {
            onComplete: finishLoad,
          }),
          tabId: activeTabId,
        };
      });
    })
    .catch((err: unknown) => {
      ctx.setIsParsing(false);
      logger.error("tab-switching: parse failed", err);
    });
}
