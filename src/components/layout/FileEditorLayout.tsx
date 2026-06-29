// §89 FileEditorLayout — minimal editor for standalone file mode
// Rendered when App.tsx detects ?mode=file&path=... URL params.
// No sidebar, no context tab bar, no panels — just editor + path bar.

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { DiffResult, MergeSegment } from "../../ipc/types";

import { EditorContent, useEditor } from "@tiptap/react";

import { createBaramExtensions } from "../../extensions";
import { useAutoSave } from "../../hooks/use-auto-save";
import { useSettingsEffects } from "../../hooks/use-settings-effects";
import { readFile, watchDir, writeFile } from "../../ipc/invoke";
import { diffTexts, mergeTexts } from "../../ipc/snapshot";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { logger } from "../../utils/logger";
import { dirname } from "../../utils/path-utils";
import { DiffView } from "../editor/DiffView";
import { MergeView } from "../editor/MergeView";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const [externalChange, setExternalChange] = useState<null | string>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [mergeState, setMergeState] = useState<MergeSegment[] | null>(null);
  const contentRef = useRef<string>("");
  const fileName = filePath.split("/").pop() ?? "Untitled";

  const editor = useEditor({
    extensions: createBaramExtensions({
      onNavigate: () => {},
      onNavigateBlockRef: () => {},
      onNavigateLocal: () => {},
      onMentionNavigate: () => {},
    }),
    autofocus: true,
    immediatelyRender: false,
  });

  // Load file content on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // §89 Register FileContext before reading
        await useContextStore.getState().ensureFileContext(filePath);
        const content = await readFile(filePath);
        if (cancelled) return;
        contentRef.current = content;

        if (editor && !editor.isDestroyed) {
          const doc = markdownToProsemirror(content, editor.schema);
          editor.commands.setContent(doc.toJSON());

          // §89 Register a virtual tab so resolveImageSrc can find the file path
          const ctx = useContextStore
            .getState()
            .contexts.find(
              (c) => c.contextType === "file" && c.path === filePath,
            );
          const tabId = `file-editor-${Date.now()}`;
          useEditorStore.getState().openTab({
            id: tabId,
            filePath,
            title: fileName,
            contextId: ctx?.id ?? "",
            isDirty: false,
            isPinned: false,
          });
        }
      } catch (err) {
        if (!cancelled) {
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
  }, [filePath, editor, fileName]);

  // §89 Auto-save, theme, and settings effects
  useAutoSave(editor);
  useSettingsEffects(editor);

  // §89 Source mode toggle (Cmd+/)
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");

  // Track dirty state
  useEffect(() => {
    if (!editor) return;
    const handler = () => setIsDirty(true);
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

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
          // Ignore if the disk already matches the editor (self-write / no-op).
          if (diskContent === prosemirrorToMarkdown(editor.state.doc)) return;
          if (isDirtyRef.current) {
            setExternalChange(diskContent);
          } else {
            contentRef.current = diskContent;
            editor.commands.setContent(
              markdownToProsemirror(diskContent, editor.schema).toJSON(),
            );
            setIsDirty(false);
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
  }, [editor, filePath]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!editor) return;
    try {
      const md = prosemirrorToMarkdown(editor.state.doc);
      await writeFile(filePath, md);
      contentRef.current = md;
      setIsDirty(false);
    } catch (err) {
      logger.error("[FileEditor] Failed to save:", err);
    }
  }, [editor, filePath]);

  // Conflict banner actions (standalone window)
  const handleReloadExternal = useCallback(() => {
    if (!editor || externalChange === null) return;
    contentRef.current = externalChange;
    editor.commands.setContent(
      markdownToProsemirror(externalChange, editor.schema).toJSON(),
    );
    setIsDirty(false);
    setExternalChange(null);
    setDiff(null);
  }, [editor, externalChange]);

  const handleKeepLocal = useCallback(() => {
    // Ignore the external change; the next save overwrites it on disk.
    setExternalChange(null);
    setDiff(null);
  }, []);

  const handleToggleDiff = useCallback(async () => {
    if (!editor || externalChange === null) return;
    if (diff) {
      setDiff(null);
      return;
    }
    try {
      const local = prosemirrorToMarkdown(editor.state.doc);
      setDiff(await diffTexts(local, externalChange));
    } catch (err) {
      logger.warn("[FileEditor] diff failed", err);
    }
  }, [editor, externalChange, diff]);

  const handleMerge = useCallback(async () => {
    if (!editor || externalChange === null) return;
    try {
      const local = prosemirrorToMarkdown(editor.state.doc);
      const result = await mergeTexts(
        contentRef.current,
        local,
        externalChange,
      );
      setMergeState(result.segments);
    } catch (err) {
      logger.warn("[FileEditor] merge failed", err);
    }
  }, [editor, externalChange]);

  const handleApplyMerge = useCallback(
    (merged: string) => {
      if (!editor) return;
      void writeFile(filePath, merged).then(() => {
        contentRef.current = merged;
        editor.commands.setContent(
          markdownToProsemirror(merged, editor.schema).toJSON(),
        );
        setIsDirty(false);
        setExternalChange(null);
        setDiff(null);
        setMergeState(null);
      });
    },
    [editor, filePath],
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
        if (!editor) return;
        setIsSourceMode((prev) => {
          if (!prev) {
            // WYSIWYG → Source: serialize current doc
            setSourceContent(prosemirrorToMarkdown(editor.state.doc));
          } else {
            // Source → WYSIWYG: parse source back into editor
            const doc = markdownToProsemirror(sourceContent, editor.schema);
            editor.commands.setContent(doc.toJSON());
          }
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, editor, sourceContent]);

  // Cleanup FileContext on window close
  useEffect(() => {
    const cleanup = async () => {
      const ctx = useContextStore
        .getState()
        .contexts.find((c) => c.contextType === "file" && c.path === filePath);
      if (ctx) {
        await useContextStore
          .getState()
          .removeContext(ctx.id)
          .catch(() => {});
      }
    };
    window.addEventListener("beforeunload", cleanup);
    return () => window.removeEventListener("beforeunload", cleanup);
  }, [filePath]);

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
          {isDirty ? "\u25CF " : ""}
          {fileName}
        </span>
        <span className="file-editor-pathbar__path" title={filePath}>
          {filePath}
        </span>
      </div>
      {externalChange !== null && (
        <div className="file-editor-conflict" role="alert">
          <span className="file-editor-conflict__msg">
            This file was modified externally.
          </span>
          <button
            className="file-editor-conflict__btn"
            onClick={handleReloadExternal}
          >
            Reload
          </button>
          <button
            className="file-editor-conflict__btn"
            onClick={handleKeepLocal}
          >
            Keep Local
          </button>
          <button className="file-editor-conflict__btn" onClick={handleMerge}>
            Merge
          </button>
          <button
            className="file-editor-conflict__btn"
            onClick={handleToggleDiff}
          >
            {diff ? "Hide Diff" : "Show Diff"}
          </button>
        </div>
      )}
      {diff && (
        <div className="file-editor-conflict-diff">
          <DiffView diff={diff} filePath={filePath} />
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
          <div className="file-editor-loading">Loading...</div>
        ) : isSourceMode ? (
          <Suspense fallback={null}>
            <SourceCodeEditor
              content={sourceContent}
              onChange={setSourceContent}
            />
          </Suspense>
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  );
}
