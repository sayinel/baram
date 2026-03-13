// §footnote FootnoteDefinition NodeView — N. content ↩ layout with back navigation
import { useCallback } from "react";

import type { Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

export function FootnoteDefinitionView({ node, editor }: NodeViewProps) {
  const identifier = node.attrs.identifier as string;
  const displayNumber = getFootnoteNumber(editor, identifier);

  // Click → scroll to the corresponding footnoteRef in the document
  const handleBack = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      let refPos = -1;
      editor.state.doc.descendants((n, pos) => {
        if (
          n.type.name === "footnoteRef" &&
          n.attrs.identifier === identifier
        ) {
          refPos = pos;
          return false;
        }
      });
      if (refPos >= 0) {
        const dom = editor.view.nodeDOM(refPos);
        if (dom instanceof HTMLElement) {
          dom.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    },
    [editor, identifier],
  );

  return (
    <NodeViewWrapper
      className="footnote-definition"
      data-identifier={identifier}
      data-type="footnote-definition"
    >
      <span
        className="footnote-definition-label"
        contentEditable={false}
        onClick={handleBack}
        title="Go to reference"
      >
        {displayNumber || identifier}.
      </span>
      <NodeViewContent className="footnote-definition-body" />
      <button
        className="footnote-definition-back"
        contentEditable={false}
        onClick={handleBack}
        title="Go to reference"
      >
        ↩
      </button>
    </NodeViewWrapper>
  );
}

/** Return display number (1-based) for a footnote identifier based on document order */
function getFootnoteNumber(editor: Editor, identifier: string): number {
  const order: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnoteRef") {
      const id = node.attrs.identifier as string;
      if (!order.includes(id)) order.push(id);
    }
  });
  const idx = order.indexOf(identifier);
  return idx >= 0 ? idx + 1 : 0;
}
