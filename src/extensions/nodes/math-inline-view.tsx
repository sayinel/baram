// §5.3 Math Inline NodeView — KaTeX render only (editing handled by MathInlineEdit plugin)
import { useEffect, useRef } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

import { preprocessNotionFormula } from "../../utils/export/notion-katex-compat";

export function MathInlineView({ node, selected }: NodeViewProps) {
  const formula = (node.attrs.formula as string) || "";
  const mathSize = (node.attrs.mathSize as string) || "normal";
  const renderRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!renderRef.current || !formula) return;
    const el = renderRef.current;
    const processed = preprocessNotionFormula(formula);
    void import("katex").then(({ default: katex }) => {
      if (!el.isConnected) return;
      try {
        katex.render(processed, el, {
          throwOnError: false,
          displayMode: false,
        });
      } catch {
        el.textContent = formula;
      }
    });
  }, [formula]);

  return (
    <NodeViewWrapper
      as="span"
      className={`math-inline math-inline-rendered ${selected ? "math-inline-selected" : ""}`}
      contentEditable={false}
      data-math-size={mathSize}
    >
      <span ref={renderRef} />
    </NodeViewWrapper>
  );
}
