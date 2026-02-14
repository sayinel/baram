// §5.1 Source Code Mode — CodeMirror 6 markdown editor
import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching } from "@codemirror/language";

interface SourceCodeEditorProps {
  content: string;
  onChange: (content: string) => void;
}

export function SourceCodeEditor({ content, onChange }: SourceCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    });

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
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
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
}
