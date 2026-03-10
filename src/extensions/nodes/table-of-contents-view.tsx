// §5.1 Table of Contents NodeView — auto-generated heading list
import { useCallback, useEffect, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

interface TocEntry {
  level: number;
  pos: number;
  text: string;
}

export function TableOfContentsView({ editor, selected }: NodeViewProps) {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const collectHeadings = useCallback(() => {
    const result: TocEntry[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        result.push({
          level: node.attrs.level as number,
          text: node.textContent,
          pos,
        });
      }
    });
    setEntries(result);
  }, [editor]);

  useEffect(() => {
    collectHeadings();

    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(collectHeadings, 200);
    };

    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, collectHeadings]);

  const handleClick = useCallback(
    (pos: number) => {
      editor
        .chain()
        .setTextSelection(pos + 1)
        .scrollIntoView()
        .focus()
        .run();
    },
    [editor],
  );

  return (
    <NodeViewWrapper
      className={`table-of-contents ${selected ? "table-of-contents-selected" : ""}`}
      contentEditable={false}
    >
      <div className="table-of-contents-header">Table of Contents</div>
      {entries.length === 0 ? (
        <div className="table-of-contents-empty">No headings</div>
      ) : (
        <ul className="table-of-contents-list">
          {entries.map((entry, i) => (
            <li
              className={`table-of-contents-item table-of-contents-level-${entry.level}`}
              key={i}
              style={{ paddingLeft: `${(entry.level - 1) * 16}px` }}
            >
              <button
                className="table-of-contents-link"
                onClick={() => handleClick(entry.pos)}
              >
                {entry.text || "(empty)"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
