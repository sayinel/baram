// §30d Bidirectional embed sync hook — write-back edited content to source block
import { useCallback, useEffect, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";

import { readFile, updateFileIndex, writeFile } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { findBlockContent, findBlockPosById } from "../utils/editor/block-nav";
import { replaceBlockInContent } from "../utils/editor/block-replace";
import { resolveWikilinkTarget } from "../utils/editor/wikilink-nav";

type EmbedStatus =
  | "block-not-found"
  | "error"
  | "file-not-found"
  | "loading"
  | "ready";

interface UseEmbedSyncOptions {
  blockId: string;
  editor: NodeViewProps["editor"];
  target: string;
}

interface UseEmbedSyncReturn {
  cancelEdit: () => void;
  commitEdit: () => Promise<void>;
  content: null | string;
  isEditing: boolean;
  startEditing: () => void;
  status: EmbedStatus;
  updateContent: (newText: string) => void;
}

const DEBOUNCE_MS = 500;

export function useEmbedSync({
  target,
  blockId,
  editor,
}: UseEmbedSyncOptions): UseEmbedSyncReturn {
  const [content, setContent] = useState<null | string>(null);
  const [status, setStatus] = useState<EmbedStatus>("loading");
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const pendingTextRef = useRef<null | string>(null);

  // Load block content
  useEffect(() => {
    if (isEditingRef.current) return; // Don't reload while editing
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        let fileContent: null | string;

        if (!target) {
          fileContent = await getSameFileContent(editor);
          if (fileContent === null) {
            if (!cancelled) {
              setContent(null);
              setStatus("error");
            }
            return;
          }
        } else {
          const resolved = resolveWikilinkTarget(target);
          if (!resolved) {
            if (!cancelled) {
              setContent(null);
              setStatus("file-not-found");
            }
            return;
          }
          const cached = useFileStore.getState().openFiles.get(resolved.path);
          fileContent =
            cached !== undefined ? cached : await readFile(resolved.path);
        }

        if (cancelled) return;

        const blockText = findBlockContent(fileContent, blockId);
        if (blockText !== null) {
          setContent(blockText);
          setStatus("ready");
        } else {
          setContent(null);
          setStatus("block-not-found");
        }
      } catch {
        if (!cancelled) {
          setContent(null);
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [target, blockId, editor]);

  const startEditing = useCallback(() => {
    isEditingRef.current = true;
    setIsEditing(true);
  }, []);

  const cancelEdit = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingTextRef.current = null;
    isEditingRef.current = false;
    setIsEditing(false);
  }, []);

  /**
   * Sync content back to source — same file uses ProseMirror transaction,
   * different file uses IPC file write.
   */
  const syncToSource = useCallback(
    async (newText: string) => {
      if (!target) {
        // Same file: update source node via ProseMirror transaction
        const pos = findBlockPosById(editor.state.doc, blockId);
        if (pos === null) return;

        const node = editor.state.doc.nodeAt(pos);
        if (!node) return;

        const { tr } = editor.state;
        // Replace the text content of the source node
        const from = pos + 1; // inside the node
        const to = pos + node.nodeSize - 1;
        if (newText) {
          tr.replaceWith(from, to, editor.state.schema.text(newText));
        } else {
          tr.delete(from, to);
        }
        tr.setMeta("embedSync", true); // Prevent infinite loops
        editor.view.dispatch(tr);
      } else {
        // Different file: read, replace, write
        const resolved = resolveWikilinkTarget(target);
        if (!resolved) return;

        let fileContent: string;
        const cached = useFileStore.getState().openFiles.get(resolved.path);
        if (cached !== undefined) {
          fileContent = cached;
        } else {
          fileContent = await readFile(resolved.path);
        }

        const replaced = replaceBlockInContent(fileContent, blockId, newText);
        if (replaced === null) return;

        await writeFile(resolved.path, replaced);
        useFileStore.getState().setFileContent(resolved.path, replaced);
        updateFileIndex(resolved.path).catch(() => {});
      }
    },
    [target, blockId, editor],
  );

  const updateContent = useCallback(
    (newText: string) => {
      setContent(newText);
      pendingTextRef.current = newText;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (pendingTextRef.current !== null) {
          syncToSource(pendingTextRef.current);
          pendingTextRef.current = null;
        }
      }, DEBOUNCE_MS);
    },
    [syncToSource],
  );

  const commitEdit = useCallback(async () => {
    // Flush pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingTextRef.current !== null) {
      await syncToSource(pendingTextRef.current);
      pendingTextRef.current = null;
    }
    isEditingRef.current = false;
    setIsEditing(false);
  }, [syncToSource]);

  // Cleanup debounce on unmount — flush any pending write synchronously
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (pendingTextRef.current !== null) {
        syncToSource(pendingTextRef.current);
        pendingTextRef.current = null;
      }
    };
  }, [syncToSource]);

  return {
    content,
    status,
    isEditing,
    startEditing,
    updateContent,
    commitEdit,
    cancelEdit,
  };
}

/**
 * Get markdown content for the current file from file store or editor serialization.
 */
async function getSameFileContent(
  editor: NodeViewProps["editor"],
): Promise<null | string> {
  const { activeTabId, tabs } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (activeTab) {
    const key = activeTab.filePath || activeTab.id;
    const cached = useFileStore.getState().openFiles.get(key);
    if (cached !== undefined) return cached;
  }

  try {
    return prosemirrorToMarkdown(editor.state.doc);
  } catch {
    return null;
  }
}
