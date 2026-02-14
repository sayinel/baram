// §4.8 Status bar — word count, cursor position, mode indicator
import { useMemo } from "react";
import type { Editor } from "@tiptap/react";

interface StatusBarProps {
  editor: Editor | null;
  isSourceMode: boolean;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function StatusBar({ editor, isSourceMode }: StatusBarProps) {
  const stats = useMemo(() => {
    if (!editor) return { words: 0, chars: 0, line: 0, col: 0 };

    const text = editor.state.doc.textContent;
    const words = countWords(text);
    const chars = text.length;

    // Get cursor position
    const { from } = editor.state.selection;
    let line = 1;
    let col = 1;
    let pos = 0;

    editor.state.doc.descendants((node, nodePos) => {
      if (pos >= from) return false;
      if (node.isBlock && nodePos < from) {
        line++;
        col = from - nodePos;
      }
      pos = nodePos + node.nodeSize;
      return true;
    });

    // Simple line/col from resolved pos
    const resolved = editor.state.doc.resolve(from);
    col = from - resolved.start(resolved.depth) + 1;
    line = 0;
    editor.state.doc.nodesBetween(0, from, (node) => {
      if (node.isBlock && node.isTextblock) {
        line++;
      }
    });
    if (line === 0) line = 1;

    return { words, chars, line, col };
  }, [editor, editor?.state.selection, editor?.state.doc]);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="status-mode">
          {isSourceMode ? "Source" : "WYSIWYG"}
        </span>
      </div>
      <div className="status-bar-right">
        <span className="status-words" title={`${stats.chars} characters`}>
          {stats.words} words
        </span>
        <span className="status-separator">|</span>
        <span className="status-position">
          Ln {stats.line}, Col {stats.col}
        </span>
      </div>
    </div>
  );
}
