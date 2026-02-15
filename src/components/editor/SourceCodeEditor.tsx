// §5.1 Source Code Mode — CodeMirror 6 markdown editor
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching } from "@codemirror/language";

export interface SourceCodeEditorRef {
  getCursorOffset(): number;
  getContent(): string;
  hasUserEdited(): boolean;
}

interface SourceCodeEditorProps {
  content: string;
  onChange: (content: string) => void;
  initialCursorOffset?: number;
}

export const SourceCodeEditor = forwardRef<SourceCodeEditorRef, SourceCodeEditorProps>(
  function SourceCodeEditor({ content, onChange, initialCursorOffset }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // Guard: prevent onChange during destroy (React StrictMode double-invoke safety)
    const isDestroyingRef = useRef(false);
    // Track whether the user has genuinely edited (vs browser/IME artifacts)
    const userEditedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      getCursorOffset(): number {
        if (!viewRef.current) return 0;
        return viewRef.current.state.selection.main.head;
      },
      getContent(): string {
        if (!viewRef.current) return "";
        return viewRef.current.state.doc.toString();
      },
      hasUserEdited(): boolean {
        return userEditedRef.current;
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      isDestroyingRef.current = false;
      userEditedRef.current = false;

      // Guard: ignore spurious docChanged during initialization
      // WebKit injects "<!--  -->" into contenteditable on focus — must be cleaned up
      const originalContent = content;
      let initialized = false;

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && !isDestroyingRef.current && initialized) {
          userEditedRef.current = true;
          onChange(update.state.doc.toString());
        }
      });

      const cursorPos = Math.min(initialCursorOffset ?? 0, content.length);

      const state = EditorState.create({
        doc: content,
        extensions: [
          keymap.of([...defaultKeymap, indentWithTab]),
          lineNumbers(),
          drawSelection(),
          bracketMatching(),
          markdown(),
          updateListener,
          EditorView.lineWrapping,
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "14px",
            },
            ".cm-content": {
              fontFamily: "var(--font-mono)",
              padding: "1rem 2rem",
            },
            ".cm-gutters": {
              backgroundColor: "var(--color-bg-secondary)",
              borderRight: "1px solid var(--color-border-light)",
            },
          }),
        ],
        selection: EditorSelection.cursor(cursorPos),
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      // Two-phase init: focus first (triggers WebKit artifacts), then clean up
      requestAnimationFrame(() => {
        if (isDestroyingRef.current) return;

        // Focus first — WebKit may inject content (e.g., "<!--  -->") on focus
        view.focus();

        // Second frame: clean up any browser-injected artifacts, then enable onChange
        requestAnimationFrame(() => {
          if (isDestroyingRef.current) return;

          // Reset document if browser injected content during focus
          const currentContent = view.state.doc.toString();
          if (currentContent !== originalContent) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: originalContent },
              selection: EditorSelection.cursor(
                Math.min(cursorPos, originalContent.length),
              ),
            });
          }

          initialized = true;

          // Scroll cursor into view
          if (cursorPos > 0) {
            view.dispatch({
              effects: EditorView.scrollIntoView(cursorPos, { y: "center" }),
            });
          }
        });
      });

      return () => {
        isDestroyingRef.current = true;
        view.destroy();
        viewRef.current = null;
      };
      // Only create once, content updates handled via onChange
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div
        ref={containerRef}
        className="source-code-editor"
        style={{ height: "100%", overflow: "auto" }}
      />
    );
  },
);
