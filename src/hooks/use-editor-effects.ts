// §44 Editor effects hook — selection tracking, content reload, goto-position, window title
import { useEffect } from "react";

import type { Editor } from "@tiptap/core";

import { EditorState, TextSelection } from "@tiptap/pm/state";
import { useShallow } from "zustand/shallow";

import { dispatchSetSearchTerm } from "../extensions/plugins/find-replace";
import { markdownToProsemirror } from "../pipeline/md-to-pm";
import { isFileTab } from "../stores/editor/editor";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { useUIStore } from "../stores/ui/ui";
import { mdLineToPmBlockStart } from "../utils/editor/cursor-mapper";

interface UseEditorEffectsParams {
  editor: Editor | null;
  editorStateCache: React.MutableRefObject<Map<string, EditorState>>;
  inlineAI: { applyContent: (content: string) => void };
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
}

export function useEditorEffects({
  editor,
  editorStateCache,
  inlineAI,
  setFindReplaceMode,
  setFindReplaceOpen,
}: UseEditorEffectsParams) {
  const { activeTabId, tabs } = useEditorStore(
    useShallow((s) => ({ activeTabId: s.activeTabId, tabs: s.tabs })),
  );

  // §44 Track editor selection text for @selection reference
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const text =
        from === to ? "" : editor.state.doc.textBetween(from, to, " ");
      useEditorStore.getState().setCurrentSelection(text);
    };
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor]);

  // §44 Apply AI chat content to editor — with diff preview when selection exists
  useEffect(() => {
    const unsub = useUIStore.subscribe((state) => {
      const content = state.pendingApplyContent;
      if (!content || !editor) return;
      const { from, to } = editor.state.selection;
      if (from !== to) {
        // Selection exists — show diff preview via AI Diff plugin
        inlineAI.applyContent(content);
      } else {
        // No selection — insert at cursor directly
        editor.chain().focus().insertContentAt(from, content).run();
      }
      useUIStore.getState().setPendingApplyContent(null);
    });
    return unsub;
  }, [editor, inlineAI]);

  // §5.11 Activate Find highlights from Global Search result click (same-tab case)
  const pendingSearchHighlight = useUIStore((s) => s.pendingSearchHighlight);
  useEffect(() => {
    if (!pendingSearchHighlight || !editor?.view) return;
    // If already consumed by activeTabId effect (tab-switch case), skip
    if (!useUIStore.getState().pendingSearchHighlight) return;
    useUIStore.getState().setPendingSearchHighlight(null);
    // Also consume pending scroll line for same-tab navigation
    const pendingLine = useLinkStore.getState().pendingScrollLine;
    if (pendingLine !== null) {
      useLinkStore.getState().setPendingScrollLine(null);
    }
    // Delay to ensure editor state is settled after tab switch
    requestAnimationFrame(() => {
      if (!editor?.view) return;
      // Scroll to specific line if pending (same-tab search result click)
      if (pendingLine !== null) {
        const { activeTabId: tabId, tabs: currentTabs } =
          useEditorStore.getState();
        const incomingTab = currentTabs.find((t) => t.id === tabId);
        const content = incomingTab?.filePath
          ? useFileStore.getState().openFiles.get(incomingTab.filePath)
          : useFileStore.getState().openFiles.get(incomingTab?.id ?? "");
        if (content !== undefined) {
          const doc = editor.view.state.doc;
          const pmPos = mdLineToPmBlockStart(doc, content, pendingLine);
          const scrollPos = Math.min(Math.max(pmPos, 0), doc.content.size);
          try {
            const resolvedPos = editor.view.state.doc.resolve(scrollPos);
            const tr = editor.view.state.tr
              .setSelection(TextSelection.near(resolvedPos))
              .scrollIntoView();
            editor.view.dispatch(tr);
            editor.view.focus();
            const domInfo = editor.view.domAtPos(scrollPos);
            const el =
              domInfo.node instanceof HTMLElement
                ? domInfo.node
                : domInfo.node.parentElement;
            el?.scrollIntoView({ block: "center" });
          } catch {
            // ignore invalid position
          }
        }
      }
      dispatchSetSearchTerm(editor.view, pendingSearchHighlight);
      setFindReplaceOpen(true);
      setFindReplaceMode("find");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFindReplaceOpen/setFindReplaceMode are stable store actions
  }, [pendingSearchHighlight, editor]);

  // §5.11 Reload editor content after Global Search Replace / Quick Capture
  const contentReloadVersion = useUIStore((s) => s.contentReloadVersion);
  useEffect(() => {
    if (!contentReloadVersion || !editor?.view) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const incomingTab = currentTabs.find((t) => t.id === tabId);
    if (!incomingTab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(incomingTab.filePath);
    if (content === undefined) return;
    // Invalidate stale EditorState caches for replaced files
    editorStateCache.current.clear();
    const cursorEnd = useUIStore.getState().contentReloadCursorEnd;
    // Re-parse and update editor from file-store
    const newDoc = markdownToProsemirror(content, editor.schema);
    const prevPos = editor.state.selection.anchor;
    const selPos = cursorEnd
      ? newDoc.content.size
      : Math.min(prevPos, newDoc.content.size);
    const newState = EditorState.create({
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(selPos), -1),
      plugins: editor.state.plugins,
    });
    editor.view.updateState(newState);
    // Focus and scroll to new cursor position after dialog closes.
    // Use DOM scrollIntoView (not ProseMirror tr.scrollIntoView) because
    // updateState bypasses the normal transaction pipeline.
    setTimeout(() => {
      try {
        editor.view.focus();
        const { from } = editor.view.state.selection;
        const domInfo = editor.view.domAtPos(from);
        const el =
          domInfo.node instanceof HTMLElement
            ? domInfo.node
            : domInfo.node.parentElement;
        el?.scrollIntoView({ block: "center" });
      } catch {
        /* ignore */
      }
    }, 50);
    // Intentionally only re-run on contentReloadVersion bump; editor and other
    // values are read from store state to avoid re-running on every edit.
  }, [contentReloadVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // §72 External content refresh (PropertiesPanel → editor sync)
  const contentRefreshKey = useEditorStore((s) => s.contentRefreshKey);
  useEffect(() => {
    if (!contentRefreshKey || !editor?.view) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(tab.filePath);
    if (content === undefined) return;
    const newDoc = markdownToProsemirror(content, editor.schema);
    const prevPos = editor.state.selection.anchor;
    const selPos = Math.min(prevPos, newDoc.content.size);
    const newState = EditorState.create({
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(selPos), -1),
      plugins: editor.state.plugins,
    });
    editor.view.updateState(newState);
    // Intentionally only re-run on contentRefreshKey bump; editor and other
    // values are read from store state to avoid re-running on every edit.
  }, [contentRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // §72c Navigate to ProseMirror position from lint results / external panels
  useEffect(() => {
    const handler = (e: CustomEvent<{ from: number }>) => {
      if (!editor) return;
      editor.commands.setTextSelection(e.detail.from);
      editor.commands.scrollIntoView();
      editor.commands.focus();
    };
    window.addEventListener("baram:goto-position", handler as EventListener);
    return () =>
      window.removeEventListener(
        "baram:goto-position",
        handler as EventListener,
      );
  }, [editor]);

  // --- Window title update ---
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    document.title = tab
      ? `${tab.isDirty && isFileTab(tab) ? "\u25CF " : ""}${tab.title} \u2014 Baram`
      : "Baram";
  }, [activeTabId, tabs]);
}
