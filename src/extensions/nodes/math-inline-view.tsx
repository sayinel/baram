// §5.3 Math Inline NodeView — KaTeX render only (editing handled by MathInlineEdit plugin)
import { useEffect, useRef } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import { preprocessNotionFormula } from "../../utils/notion-katex-compat";

export function MathInlineView({ node, selected }: NodeViewProps) {
  const formula = (node.attrs.formula as string) || "";
  const mathSize = (node.attrs.mathSize as string) || "normal";
  const renderRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!renderRef.current || !formula) return;
    try {
      katex.render(preprocessNotionFormula(formula), renderRef.current, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      renderRef.current.textContent = formula;
    }
  }, [formula]);

  return (
    <NodeViewWrapper
      as="span"
      className={`math-inline math-inline-rendered ${selected ? "math-inline-selected" : ""}`}
      data-math-size={mathSize}
      contentEditable={false}
    >
      <span ref={renderRef} />
    </NodeViewWrapper>
  );
}
