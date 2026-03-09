// §4.3 Outline sidebar — heading hierarchy from editor
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

interface OutlineProps {
  editor: Editor | null;
}

function extractHeadings(editor: Editor): HeadingItem[] {
  const headings: HeadingItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        level: node.attrs.level as number,
        text: node.textContent,
        pos,
      });
    }
  });
  return headings;
}

export function Outline({ editor }: OutlineProps) {
  // Re-extract headings on every document change via useEditorState
  const headings = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return [];
      return extractHeadings(ed);
    },
  });

  if (!editor || !headings) {
    return <div className="outline-empty">No editor</div>;
  }

  if (headings.length === 0) {
    return <div className="outline-empty">No headings</div>;
  }

  return (
    <div className="outline">
      {headings.map((h, i) => (
        <div
          key={i}
          className={`outline-item outline-h${h.level}`}
          style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
          onClick={() => {
            editor.commands.focus();
            editor.commands.setTextSelection(h.pos + 1);
            const domNode = editor.view.domAtPos(h.pos + 1);
            if (domNode.node instanceof HTMLElement) {
              domNode.node.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            } else if (domNode.node.parentElement) {
              domNode.node.parentElement.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
          }}
        >
          <span className="outline-level">H{h.level}</span>
          <span className="outline-text">{h.text}</span>
        </div>
      ))}
    </div>
  );
}
