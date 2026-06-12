// §footnote FootnoteRef NodeView — superscript with hover preview + click navigation
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

// §perf-large-file: Shared cache — one doc walk per doc change, all instances read from it.
// §perf-large-file C3.4: keyed by editor instance via WeakMap so two concurrent editor
// instances (C3.5 dual-editor) never share a cache entry.
interface FootnoteCache {
  doc: PmNode;
  order: Map<string, number>;
}
const _footnoteCache = new WeakMap<Editor, FootnoteCache>();

export function FootnoteRefView({ node, editor, selected }: NodeViewProps) {
  const identifier = node.attrs.identifier as string;
  const displayNumber = getFootnoteNumber(editor, identifier);
  const [tooltipText, setTooltipText] = useState<null | string>(null);
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
      className={`footnote-ref ${selected ? "footnote-ref-selected" : ""}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={wrapperRef}
    >
      {displayNumber || identifier}
      {showTooltip && tooltipText && (
        <div
          className="footnote-ref-tooltip"
          contentEditable={false}
          ref={tooltipRef}
        >
          {tooltipText.length > 200
            ? tooltipText.slice(0, 200) + "…"
            : tooltipText}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function getFootnoteNumber(editor: Editor, identifier: string): number {
  const doc = editor.state.doc;
  const cached = _footnoteCache.get(editor);
  if (cached && cached.doc === doc) {
    return cached.order.get(identifier) ?? 0;
  }
  // Cache miss: rebuild the order map for this editor's current doc.
  const order = new Map<string, number>();
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "footnoteRef") {
      const id = node.attrs.identifier as string;
      if (!order.has(id)) {
        count++;
        order.set(id, count);
      }
    }
  });
  _footnoteCache.set(editor, { doc, order });
  return order.get(identifier) ?? 0;
}
