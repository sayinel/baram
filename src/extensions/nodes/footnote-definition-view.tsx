// §footnote FootnoteDefinition NodeView — N. content ↩ layout with back navigation
import { useCallback } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";

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
      data-type="footnote-definition"
      data-identifier={identifier}
      className="footnote-definition"
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
