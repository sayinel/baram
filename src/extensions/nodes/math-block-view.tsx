// §5.3 Math Block NodeView — split source + KaTeX preview
import { useState, useEffect, useRef } from "react";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { parseKaTeXError } from "../../utils/katex-error";

export function MathBlockView({ node, selected }: NodeViewProps) {
  const formula = node.textContent || "";
  const mathSize = (node.attrs.mathSize as string) || "normal";
  const previewRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Render KaTeX preview — always visible alongside source
  useEffect(() => {
    if (!previewRef.current) return;

    if (!formula.trim()) {
      previewRef.current.textContent = "(empty equation)";
      previewRef.current.className = "math-block-katex math-block-katex-empty";
      setError(null);
      return;
    }

    // First try strict render to detect errors
    try {
      katex.render(formula, previewRef.current, {
        throwOnError: true,
        displayMode: true,
      });
      previewRef.current.className = "math-block-katex";
      setError(null);
    } catch (err) {
      // Parse and store error
      setError(parseKaTeXError(err));
      // Render with throwOnError: false for partial output
      try {
        katex.render(formula, previewRef.current, {
          throwOnError: false,
          displayMode: true,
        });
        previewRef.current.className = "math-block-katex";
      } catch {
        previewRef.current.textContent = formula;
        previewRef.current.className = "math-block-katex";
      }
    }
  }, [formula]);

  return (
    <NodeViewWrapper
      className={`math-block math-block-split ${selected ? "math-block-selected" : ""}`}
      data-math-size={mathSize}
    >
      <div className="math-block-source-section" contentEditable={false}>
        <span className="math-block-section-label">LaTeX</span>
      </div>
      <NodeViewContent className="math-block-source" />

      <div className="math-block-preview-section" contentEditable={false}>
        <span className="math-block-section-label">Preview</span>
        <div ref={previewRef} className="math-block-katex" contentEditable={false} />
      </div>

      {error && (
        <div className="math-block-error" contentEditable={false}>
          {error}
        </div>
      )}
    </NodeViewWrapper>
  );
}
