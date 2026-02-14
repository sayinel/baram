// §5.3 Math Inline NodeView — KaTeX rendered inline math with preview popover
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { parseKaTeXError } from "../../utils/katex-error";

export function MathInlineView({ node, updateAttributes, selected }: NodeViewProps) {
  const formula = (node.attrs.formula as string) || "";
  const mathSize = (node.attrs.mathSize as string) || "normal";
  const [editing, setEditing] = useState(!formula);
  const [editValue, setEditValue] = useState(formula);
  const inputRef = useRef<HTMLInputElement>(null);
  const renderRef = useRef<HTMLSpanElement>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const popoverPreviewRef = useRef<HTMLDivElement>(null);

  // Render KaTeX when not editing
  useEffect(() => {
    if (editing || !renderRef.current) return;
    try {
      katex.render(formula, renderRef.current, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      renderRef.current.textContent = formula;
    }
  }, [formula, editing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Update popover position during editing
  useEffect(() => {
    if (!editing || !wrapperRef.current) {
      setPopoverPos(null);
      return;
    }

    const updatePos = () => {
      if (!wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      setPopoverPos({
        left: rect.left,
        top: rect.bottom + 4,
      });
    };

    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);

    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [editing]);

  // Render popover preview
  useEffect(() => {
    if (!editing || !popoverPreviewRef.current) return;
    const trimmed = editValue.trim();

    if (!trimmed) {
      popoverPreviewRef.current.textContent = "";
      setPreviewError(null);
      return;
    }

    try {
      katex.render(trimmed, popoverPreviewRef.current, {
        throwOnError: true,
        displayMode: false,
      });
      setPreviewError(null);
    } catch (err) {
      setPreviewError(parseKaTeXError(err));
      try {
        katex.render(trimmed, popoverPreviewRef.current, {
          throwOnError: false,
          displayMode: false,
        });
      } catch {
        popoverPreviewRef.current.textContent = trimmed;
      }
    }
  }, [editValue, editing]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed) {
      updateAttributes({ formula: trimmed });
    }
    setEditing(false);
  }, [editValue, updateAttributes]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setEditValue(formula);
        setEditing(false);
      }
    },
    [commitEdit, formula],
  );

  if (editing) {
    return (
      <>
        <NodeViewWrapper
          as="span"
          className="math-inline math-inline-editing"
          data-math-size={mathSize}
          ref={wrapperRef}
        >
          <span className="math-inline-dollar" contentEditable={false}>$</span>
          <input
            ref={inputRef}
            className="math-inline-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            size={Math.max(editValue.length, 1)}
          />
          <span className="math-inline-dollar" contentEditable={false}>$</span>
        </NodeViewWrapper>
        {popoverPos && editValue.trim() && createPortal(
          <div
            className="math-inline-preview-popover"
            style={{ left: popoverPos.left, top: popoverPos.top }}
          >
            <div ref={popoverPreviewRef} className="math-inline-preview-content" />
            {previewError && (
              <div className="math-inline-preview-error">{previewError}</div>
            )}
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`math-inline math-inline-rendered ${selected ? "math-inline-selected" : ""}`}
      data-math-size={mathSize}
      onClick={() => {
        setEditValue(formula);
        setEditing(true);
      }}
      contentEditable={false}
    >
      <span ref={renderRef} />
    </NodeViewWrapper>
  );
}
