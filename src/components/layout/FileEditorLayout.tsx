// §89 FileEditorLayout — minimal editor for standalone file mode
// Rendered when App.tsx detects ?mode=file&path=... URL params.
// No sidebar, no context tab bar, no panels — just editor + path bar.

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { MergeSegment } from "../../ipc/types";

import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { CircleSmall } from "lucide-react";

import { createBaramExtensions } from "../../extensions";
import { replaceEditorStateWithVim } from "../../extensions/plugins/vim/replace-editor-state";
import { useAutoSave } from "../../hooks/use-auto-save";
import { useFileWindowGuard } from "../../hooks/use-file-window-guard";
import { useSettingsEffects } from "../../hooks/use-settings-effects";
import { useTranslation } from "../../i18n/useTranslation";
import { readFile, watchDir, writeFile } from "../../ipc/invoke";
import { mergeTexts } from "../../ipc/snapshot";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useContextStore } from "../../stores/context/context";
import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { isMarkdownHref } from "../../utils/editor/local-link-nav";
import {
  markContentLoaded,
  updateOriginalDoc,
} from "../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { logger } from "../../utils/logger";
import { dirname } from "../../utils/path-utils";
import { MergeView } from "../editor/MergeView";
import { UnsavedChangesModal } from "../editor/UnsavedChangesModal";
import "../../styles/editor.css";
import "../../styles/file-editor.css";

const SourceCodeEditor = lazy(() =>
  import("../editor/SourceCodeEditor").then((m) => ({
    default: m.SourceCodeEditor,
  })),
);

interface FileEditorLayoutProps {
  filePath: string;
}

export function FileEditorLayout({ filePath }: FileEditorLayoutProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);
  // This window's one tab. `use-auto-save` keeps its marks, as for a tab in the main window.
  const [tabId, setTabId] = useState<null | string>(null);
  const tabIdRef = useRef<null | string>(null);
  const isDirty = useEditorStore((s) =>
    isTabUnsaved(
      s.tabs.find((t) => t.id === tabId),
      s.sourceEditedTabs,
    ),
  );
  const isDirtyRef = useRef(false);
  const [externalChange, setExternalChange] = useState<null | string>(null);
  const [mergeState, setMergeState] = useState<MergeSegment[] | null>(null);
  const fileName = filePath.split("/").pop() ?? "Untitled";

  // §298 vim §12-⑪: referentially stable extensions — see App.tsx. A fresh
  // array per render makes useEditor's option sync copy view.editable into
  // options.editable, bricking the editor to read-only during vim normal.
  const extensions = useMemo(
    () =>
      createBaramExtensions({
        onNavigate: () => {},
        onNavigateBlockRef: () => {},
        // §89 standalone window has no file tree and no tabs, so there is
        // nothing to navigate to and every callback here is a no-op.
        //
        // ‼️ Not `() => false`. Declining would send a markdown href to the OS
        // opener, and the pre-§278.1 predicate claimed markdown before any
        // callback ran — so `[x](/other/note.md)` would newly hand an absolute
        // path to the OS from a window that has no navigation at all. Claiming
        // markdown and declining the rest reproduces that predicate exactly,
        // which keeps scheme-less external addresses (www.example.com) opening.
        onNavigateLocal: (href) => isMarkdownHref(href),
        onMentionNavigate: () => {},
      }),
    [],
  );

  const editor = useEditor({
    extensions,
    autofocus: true,
    immediatelyRender: false,
  });

  // §89 Source mode toggle (Cmd+/)
  const [isSourceMode, setIsSourceMode] = useState(false);
  const isSourceModeRef = useRef(isSourceMode);
  isSourceModeRef.current = isSourceMode;
  const [sourceContent, setSourceContent] = useState("");
  // §312 SourceCodeEditor의 동기화 effect는 **effect 시점의** 진실원을 다시 읽는다.
  // 렌더 스냅샷(`sourceContent`)을 그대로 접근자로 넘기면, 렌더와 effect 사이에 사용자가
  // 친 글자를 낡은 값으로 지운다 — 그 prop이 optional이 아닌 이유다.
  const sourceContentRef = useRef(sourceContent);
  sourceContentRef.current = sourceContent;

  const markClean = useCallback(() => {
    const id = tabIdRef.current;
    if (!id) return;
    const store = useEditorStore.getState();
    store.markDirty(id, false);
    store.markSourceEdited(id, false);
  }, []);

  // What this window would write now. In source mode the text is in the buffer, and the document
  // is still what it was when source mode began.
  const currentText = useCallback(
    (live: NonNullable<typeof editor>) =>
      isSourceModeRef.current
        ? sourceContentRef.current
        : serializeLiveDoc(live),
    [],
  );

  // Text that is the file, in place of what this window shows, as a whole new state like a tab
  // switch installs. No `update`, so `use-auto-save` does not read it as an edit and write it back,
  // and no undo history, because undoing would write the older text back over the file, or nothing
  // at all on a window just opened. `addToHistory: false` is not enough: an earlier step that
  // replaced the whole document maps through it and comes back.
  const installSavedDocument = useCallback(
    (markdown: string) => {
      if (!editor) return;
      useFileStore.getState().setFileContent(filePath, markdown);
      const doc = markdownToProsemirror(markdown, editor.schema);
      const caret = Math.min(editor.state.selection.anchor, doc.content.size);
      replaceEditorStateWithVim(
        editor.view,
        EditorState.create({
          doc,
          plugins: editor.state.plugins,
          selection: TextSelection.near(doc.resolve(caret), -1),
        }),
        "fresh-document",
      );
      setSourceContent(markdown);
      if (tabIdRef.current) markContentLoaded(tabIdRef.current);
      markClean();
    },
    [editor, filePath, markClean],
  );

  // Nothing is in dispute with the file any more, so `use-auto-save` may write again.
  const settleExternalChange = useCallback(() => {
    const { getFileMtime, updateLastSaveMtime } = useFileStore.getState();
    const mtime = getFileMtime(filePath);
    if (mtime && mtime.canReloadMtime > mtime.lastSaveMtime) {
      updateLastSaveMtime(filePath, mtime.canReloadMtime);
    }
    setExternalChange(null);
  }, [filePath]);

  // Load file content on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // §89 Register FileContext before reading. Nothing releases it when this window closes:
        // the backend keeps one per path, so a tab in the main window can be using the same one,
        // and removing it would refuse that tab's writes. Left behind, it covers one file the user
        // has already approved, until the app exits.
        await useContextStore.getState().ensureFileContext(filePath);
        const content = await readFile(filePath);
        if (cancelled) return;

        if (editor && !editor.isDestroyed) {
          // §89 Register a virtual tab so resolveImageSrc can find the file path
          const ctx = useContextStore
            .getState()
            .contexts.find(
              (c) => c.contextType === "file" && c.path === filePath,
            );
          useEditorStore.getState().openTab({
            id: `file-editor-${Date.now()}`,
            filePath,
            title: fileName,
            contextId: ctx?.id ?? "",
            isDirty: false,
            isPinned: false,
          });
          // Not the id above: `openTab` keeps the tab already open for this path, which there is
          // when Retry on the `ErrorBoundary` screen has remounted this component.
          const { activeTabId } = useEditorStore.getState();
          tabIdRef.current = activeTabId;
          setTabId(activeTabId);
          installSavedDocument(content);
          // A Retry can come back with the hold of a banner that went with the old component.
          settleExternalChange();
        }
      } catch (err) {
        if (!cancelled) {
          // The tab may already be open with nothing installed, and a save would write that.
          tabIdRef.current = null;
          setTabId(null);
          setError(err instanceof Error ? err.message : String(err));
          logger.error("[FileEditor] Failed to load file:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, editor, fileName, installSavedDocument, settleExternalChange]);

  // §89 Auto-save, theme, and settings effects
  useAutoSave(editor);
  useSettingsEffects(editor);

  // Keep isDirty in a ref for the file:changed listener closure.
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // §3.6 External change detection for standalone file windows: watch the parent
  // directory and react to file:changed for this file. Clean buffers reload
  // silently; dirty buffers surface an inline conflict banner.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    let unlisten: undefined | UnlistenFn;
    const dir = dirname(filePath);
    if (dir) watchDir(dir).catch(() => {});
    (async () => {
      const fn = await listen<{ mtime: number; path: string }>(
        "file:changed",
        async (event) => {
          if (event.payload.path !== filePath) return;
          if (!editor || editor.isDestroyed) return;
          let diskContent: string;
          try {
            diskContent = await readFile(filePath);
          } catch {
            return;
          }
          // This window's own write coming back, or a write of what it already holds.
          if (
            diskContent === useFileStore.getState().openFiles.get(filePath) ||
            diskContent === currentText(editor)
          ) {
            settleExternalChange();
            return;
          }
          if (isDirtyRef.current) {
            // Holds `use-auto-save` off (`shouldDeferSave`) until the banner is answered, or a
            // timer already running writes over what the banner is asking about. The main window
            // does this in `useFileWatcher`, which this window does not run. Past the last save
            // whatever the file says: a copy that keeps its time (`cp -p`, `rsync -t`) can be older.
            const { getFileMtime, updateCanReloadMtime } =
              useFileStore.getState();
            updateCanReloadMtime(
              filePath,
              Math.max(
                event.payload.mtime,
                (getFileMtime(filePath)?.lastSaveMtime ?? 0) + 1,
              ),
            );
            setExternalChange(diskContent);
          } else {
            installSavedDocument(diskContent);
          }
        },
      );
      if (cancelled) fn();
      else unlisten = fn;
    })().catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    currentText,
    editor,
    filePath,
    installSavedDocument,
    settleExternalChange,
  ]);

  // Save handler
  const handleSave = useCallback(async () => {
    // Before the file has loaded the editor is empty, and writing that would empty the file.
    const id = tabIdRef.current;
    if (!editor || !id) return;
    try {
      const doc = editor.state.doc;
      const md = currentText(editor);
      await writeFile(filePath, md);
      const { setFileContent, updateLastSaveMtime } = useFileStore.getState();
      setFileContent(filePath, md);
      updateLastSaveMtime(filePath, Date.now());
      // Whatever the banner was asking about, the file now says this.
      setExternalChange(null);
      // Text typed during the write is not on disk, so it stays marked.
      if (currentText(editor) !== md) return;
      if (isSourceModeRef.current) {
        // The document behind the buffer has to become this text too. An auto-save timer from before
        // source mode would write the older document over this save, and what was typed then undone
        // would compare with a baseline the file has moved on from.
        installSavedDocument(md);
        return;
      }
      // The next edit is compared with what is on disk now. Compared with what the window opened
      // on, text put back to that would read as saved.
      updateOriginalDoc(id, doc);
      markClean();
    } catch (err) {
      logger.error("[FileEditor] Failed to save:", err);
    }
  }, [currentText, editor, filePath, installSavedDocument, markClean]);

  useFileWindowGuard(tabId, isDirty, handleSave);

  // Conflict banner actions (standalone window)

  const handleReloadExternal = useCallback(() => {
    if (!editor || externalChange === null) return;
    installSavedDocument(externalChange);
    settleExternalChange();
  }, [editor, externalChange, installSavedDocument, settleExternalChange]);

  const handleKeepLocal = useCallback(() => {
    // Ignore the external change; the next save overwrites it on disk.
    settleExternalChange();
  }, [settleExternalChange]);

  const handleMerge = useCallback(async () => {
    if (!editor || externalChange === null) return;
    try {
      const result = await mergeTexts(
        useFileStore.getState().openFiles.get(filePath) ?? "",
        currentText(editor),
        externalChange,
      );
      setMergeState(result.segments);
    } catch (err) {
      logger.warn("[FileEditor] merge failed", err);
    }
  }, [currentText, editor, externalChange, filePath]);

  const handleApplyMerge = useCallback(
    (merged: string) => {
      if (!editor) return;
      void writeFile(filePath, merged).then(() => {
        installSavedDocument(merged);
        settleExternalChange();
        setMergeState(null);
      });
    },
    [editor, filePath, installSavedDocument, settleExternalChange],
  );

  // Keyboard shortcuts: Cmd+S (save), Cmd+/ (source mode toggle)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        // Before the file has loaded there is nothing to show, and text typed into that empty
        // buffer would replace the file on the next save.
        if (!editor || !tabIdRef.current) return;
        if (!isSourceMode) {
          // WYSIWYG → Source: serialize current doc
          setSourceContent(serializeLiveDoc(editor));
        } else {
          // Source → WYSIWYG. Text still unsaved arrives as an edit for `use-auto-save` to mark and
          // save. Anything else is in the document already: a save there put it in.
          const id = tabIdRef.current;
          const { markSourceEdited, sourceEditedTabs } =
            useEditorStore.getState();
          if (sourceEditedTabs.includes(id)) {
            editor.commands.setContent(
              markdownToProsemirror(sourceContent, editor.schema).toJSON(),
            );
            markSourceEdited(id, false);
          }
        }
        setIsSourceMode(!isSourceMode);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, editor, sourceContent, isSourceMode]);

  if (error) {
    return (
      <div className="file-editor-layout">
        <div className="file-editor-pathbar">{filePath}</div>
        <div className="file-editor-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="file-editor-layout">
      <div className="file-editor-pathbar">
        <span className="file-editor-pathbar__name">
          {isDirty && (
            <>
              <CircleSmall
                aria-label={t("common.unsaved")}
                className="icon-inline"
                fill="currentColor"
                role="img"
                size="1em"
              />{" "}
            </>
          )}
          {fileName}
        </span>
        <span className="file-editor-pathbar__path" title={filePath}>
          {filePath}
        </span>
      </div>
      {externalChange !== null && (
        <div className="file-editor-conflict" role="alert">
          <span className="file-editor-conflict__msg">
            {t("fileEditor.conflict.msg")}
          </span>
          <button
            className="file-editor-conflict__btn"
            onClick={handleReloadExternal}
          >
            {t("fileEditor.conflict.reload")}
          </button>
          <button
            className="file-editor-conflict__btn"
            onClick={handleKeepLocal}
          >
            {t("fileEditor.conflict.keepLocal")}
          </button>
          <button className="file-editor-conflict__btn" onClick={handleMerge}>
            {t("fileEditor.conflict.merge")}
          </button>
        </div>
      )}
      {mergeState && (
        <MergeView
          filePath={filePath}
          onApply={handleApplyMerge}
          onCancel={() => setMergeState(null)}
          segments={mergeState}
        />
      )}
      <div className="file-editor-content">
        {loading ? (
          <div className="file-editor-loading">{t("fileEditor.loading")}</div>
        ) : isSourceMode ? (
          <Suspense fallback={null}>
            <SourceCodeEditor
              content={sourceContent}
              getLatestContent={() => sourceContentRef.current}
              onChange={(next) => {
                setSourceContent(next);
                if (tabId) {
                  useEditorStore.getState().markSourceEdited(tabId, true);
                }
              }}
            />
          </Suspense>
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
      <UnsavedChangesModal handleSave={handleSave} />
    </div>
  );
}
