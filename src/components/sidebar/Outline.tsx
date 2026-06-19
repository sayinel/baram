// §4.3 Outline sidebar — heading hierarchy from editor
import { useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { useEditorContext } from "../../contexts/editor-context";

interface HeadingItem {
  level: number;
  pos: number;
  text: string;
}

export function Outline() {
  const editor = useEditorContext();
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // §perf-large-file C4: extract headings on a debounced `update` listener
  // instead of useEditorState. useEditorState reran extractHeadings (a whole-doc
  // descendants walk over ~1,391 headings on the perf fixture) on EVERY
  // transaction — including pure selection changes (cursor moves) — so an open
  // Outline panel was a per-keystroke whole-doc cost on large files. A 200ms
  // debounce on `update` only (matching table-of-contents-view) skips the walk
  // during a typing burst and ignores selection-only transactions entirely.
  useEffect(() => {
    if (!editor) return;

    const collect = () => {
      if (editor.isDestroyed) return;
      setHeadings(extractHeadings(editor));
    };
    collect();

    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(collect, 200);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor]);

  if (!editor) {
    return <div className="outline-empty">No editor</div>;
  }

  if (headings.length === 0) {
    return <div className="outline-empty">No headings</div>;
  }

  return (
    <div className="outline">
      {headings.map((h, i) => (
        <div
          className={`outline-item outline-h${h.level}`}
          key={i}
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
          style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
        >
          <span className="outline-level">H{h.level}</span>
          <span className="outline-text text-truncate">{h.text}</span>
        </div>
      ))}
    </div>
  );
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
