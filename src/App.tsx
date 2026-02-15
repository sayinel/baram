// §4.2 Baram App — 3-Column layout with editor
import { Component, useEffect, useState, useCallback, useRef } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { createBaramExtensions } from "./extensions";
import { prosemirrorToMarkdown } from "./pipeline/pm-to-md";
import { markdownToProsemirror } from "./pipeline/md-to-pm";
import { SourceCodeEditor } from "./components/editor/SourceCodeEditor";
import type { SourceCodeEditorRef } from "./components/editor/SourceCodeEditor";
import { pmPosToMdOffset, mdOffsetToPmPos } from "./utils/cursor-mapper";
import { AppLayout } from "./components/layout/AppLayout";
import { TabBar } from "./components/layout/TabBar";
import { StatusBar } from "./components/layout/StatusBar";
import { CommandPalette } from "./components/command/CommandPalette";
import { FloatingToolbar } from "./components/toolbar/FloatingToolbar";
import { BlockHandle } from "./components/toolbar/BlockHandle";
import { ContextMenu } from "./components/toolbar/ContextMenu";
import { useUIStore } from "./stores/ui-store";
import "./App.css";

// Error boundary to catch and display runtime errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Baram ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "red", fontFamily: "monospace" }}>
          <h2>Runtime Error</h2>
          <pre>{this.state.error.message}</pre>
          <pre style={{ fontSize: "0.8em", color: "#666" }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const [sourceCursorOffset, setSourceCursorOffset] = useState(0);
  const sourceEditorRef = useRef<SourceCodeEditorRef>(null);
  // Ref mirrors sourceContent state — always has the latest value, immune to stale closures
  const sourceContentRef = useRef("");
  const { toggleSidebar, toggleCommandPalette } = useUIStore();

  const editor = useEditor({
    extensions: createBaramExtensions(),
    autofocus: true,
    immediatelyRender: false,
  });

  // Stable onChange for SourceCodeEditor — updates both ref and state
  const handleSourceChange = useCallback((content: string) => {
    sourceContentRef.current = content;
    setSourceContent(content);
  }, []);

  // Cmd+/ toggle between WYSIWYG and Source Code mode (§5.1 cursor preservation)
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;

    if (!isSourceMode) {
      // WYSIWYG → Source: map PM cursor to markdown offset
      const md = prosemirrorToMarkdown(editor.state.doc);
      const pmPos = editor.state.selection.from;
      const mdOffset = pmPosToMdOffset(editor.state.doc, pmPos, md);

      sourceContentRef.current = md;
      setSourceContent(md);
      setSourceCursorOffset(mdOffset);
      setIsSourceMode(true);
    } else {
      // Source → WYSIWYG
      // Use original markdown unless the user actually edited in Source mode.
      // WebKit injects "<!--  -->" into CodeMirror on focus — getContent()
      // would return corrupted content if the user didn't edit.
      const userEdited = sourceEditorRef.current?.hasUserEdited() ?? false;
      const currentSource = userEdited
        ? (sourceEditorRef.current?.getContent() ?? sourceContentRef.current)
        : sourceContentRef.current;
      const mdOffset = sourceEditorRef.current?.getCursorOffset() ?? 0;

      const newDoc = markdownToProsemirror(currentSource, editor.schema);
      const pmPos = mdOffsetToPmPos(newDoc, mdOffset, currentSource);

      // Replace the ProseMirror state directly (bypasses Tiptap setContent
      // which can conflict with EditorContent mount/unmount lifecycle)
      const clampedPos = Math.min(Math.max(pmPos, 0), newDoc.content.size);
      const newState = EditorState.create({
        doc: newDoc,
        plugins: editor.state.plugins,
        selection: TextSelection.near(newDoc.resolve(clampedPos)),
      });
      editor.view.updateState(newState);

      setIsSourceMode(false);

      // Focus after EditorContent mounts
      requestAnimationFrame(() => {
        try {
          editor.commands.focus();
        } catch {
          // ignore focus errors
        }
      });
    }
  }, [editor, isSourceMode]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+/ — toggle source mode
      if (mod && e.key === "/") {
        e.preventDefault();
        toggleSourceMode();
        return;
      }

      // Cmd+Shift+L — toggle left sidebar
      if (mod && e.shiftKey && e.key === "L") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+K — command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSourceMode, toggleSidebar, toggleCommandPalette, editor, isSourceMode]);

  return (
    <>
      <AppLayout
        editor={editor}
        statusBar={<StatusBar editor={editor} isSourceMode={isSourceMode} />}
      >
        <TabBar />
        <div className="editor-area">
          {isSourceMode ? (
            <SourceCodeEditor
              ref={sourceEditorRef}
              content={sourceContent}
              onChange={handleSourceChange}
              initialCursorOffset={sourceCursorOffset}
            />
          ) : (
            <>
              <EditorContent editor={editor} />
              {editor && (
              <>
                <FloatingToolbar editor={editor} />
                <BlockHandle editor={editor} />
                <ContextMenu editor={editor} />
              </>
            )}
            </>
          )}
        </div>
      </AppLayout>
      <CommandPalette editor={editor} onToggleSourceMode={toggleSourceMode} />
    </>
  );
}

function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;
