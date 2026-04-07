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

import { EditorContent, useEditor } from "@tiptap/react";

import { createBaramExtensions } from "../../extensions";
import { useAutoSave } from "../../hooks/use-auto-save";
import { useSettingsEffects } from "../../hooks/use-settings-effects";
import { readFile, writeFile } from "../../ipc/invoke";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { useContextStore } from "../../stores/context/context";
import { logger } from "../../utils/logger";
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
  }, [filePath, editor]);

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
