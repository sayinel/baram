// §4.2 Baram App — 3-Column layout with editor
import { Component, useEffect, useState, useCallback } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { createBaramExtensions } from "./extensions";
import { prosemirrorToMarkdown } from "./pipeline/pm-to-md";
import { markdownToProsemirror } from "./pipeline/md-to-pm";
import { SourceCodeEditor } from "./components/editor/SourceCodeEditor";
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
  const { toggleSidebar, toggleCommandPalette } = useUIStore();

  const editor = useEditor({
    extensions: createBaramExtensions(),
    autofocus: true,
    immediatelyRender: false,
  });

  // Cmd+/ toggle between WYSIWYG and Source Code mode
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;

    if (!isSourceMode) {
      const md = prosemirrorToMarkdown(editor.state.doc);
      setSourceContent(md);
      setIsSourceMode(true);
    } else {
      const doc = markdownToProsemirror(sourceContent, editor.schema);
      editor.commands.setContent(doc.toJSON());
      setIsSourceMode(false);
      editor.commands.focus();
    }
  }, [editor, isSourceMode, sourceContent]);

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

      // Cmd+K — command palette (when no selection in editor)
      if (mod && e.key === "k") {
        const hasSelection =
          editor && !editor.state.selection.empty && !isSourceMode;
        if (!hasSelection) {
          e.preventDefault();
          toggleCommandPalette();
        }
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
              content={sourceContent}
              onChange={setSourceContent}
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
