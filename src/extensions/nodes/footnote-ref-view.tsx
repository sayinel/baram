// §footnote FootnoteRef NodeView — superscript with hover preview + click navigation
import { useCallback, useState, useRef, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

// §perf-large-file: Shared cache — one doc walk per doc change, all instances read from it
let _cachedDoc: PmNode | null = null;
let _footnoteOrder: Map<string, number> = new Map(); // identifier → 1-based number

function getFootnoteNumber(editor: Editor, identifier: string): number {
  const doc = editor.state.doc;
  if (doc !== _cachedDoc) {
    _cachedDoc = doc;
    _footnoteOrder = new Map();
    let count = 0;
    doc.descendants((node) => {
      if (node.type.name === "footnoteRef") {
        const id = node.attrs.identifier as string;
        if (!_footnoteOrder.has(id)) {
          count++;
          _footnoteOrder.set(id, count);
        }
      }
    });
  }
  return _footnoteOrder.get(identifier) ?? 0;
}

export function FootnoteRefView({ node, editor, selected }: NodeViewProps) {
  const identifier = node.attrs.identifier as string;
  const displayNumber = getFootnoteNumber(editor, identifier);
  const [tooltipText, setTooltipText] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const wrapperRef = useRef<HTMLElement>(null);

  // Extract definition content text for tooltip preview
  const getDefinitionText = useCallback((): string => {
    let text = "";
    editor.state.doc.descendants((n) => {
      if (
        n.type.name === "footnoteDefinition" &&
        n.attrs.identifier === identifier
      ) {
        n.descendants((child) => {
          if (child.isText) {
            text += child.text;
          }
        });
        return false;
      }
    });
    return text || "(empty)";
  }, [editor, identifier]);

  // Click → scroll to footnote definition
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Find the footnoteDefinition position
      let defPos = -1;
      editor.state.doc.descendants((n, pos) => {
        if (
          n.type.name === "footnoteDefinition" &&
          n.attrs.identifier === identifier
        ) {
          defPos = pos;
          return false;
        }
      });
      if (defPos >= 0) {
        const dom = editor.view.nodeDOM(defPos);
        if (dom instanceof HTMLElement) {
          dom.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    },
    [editor, identifier],
  );

  // Hover handlers for tooltip
  const handleMouseEnter = useCallback(() => {
    setTooltipText(getDefinitionText());
    setShowTooltip(true);
  }, [getDefinitionText]);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  // Position tooltip above when too close to bottom
  const tooltipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showTooltip && tooltipRef.current && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom + 60 > viewportHeight) {
        tooltipRef.current.style.bottom = "100%";
        tooltipRef.current.style.top = "auto";
      }
    }
  }, [showTooltip]);

  return (
    <NodeViewWrapper
      as="sup"
      ref={wrapperRef}
      className={`footnote-ref ${selected ? "footnote-ref-selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {displayNumber || identifier}
      {showTooltip && tooltipText && (
        <div
          ref={tooltipRef}
          className="footnote-ref-tooltip"
          contentEditable={false}
        >
          {tooltipText.length > 200
            ? tooltipText.slice(0, 200) + "…"
            : tooltipText}
        </div>
      )}
    </NodeViewWrapper>
  );
}
