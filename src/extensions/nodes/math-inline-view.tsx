// §5.3 Math Inline NodeView — KaTeX render only (editing handled by MathInlineEdit plugin)
import { useEffect, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

import { preprocessNotionFormula } from "../../utils/export/notion-katex-compat";
import { onFirstVisible } from "./views/lazy-visible";

export function MathInlineView({ node, selected }: NodeViewProps) {
  const formula = (node.attrs.formula as string) || "";
  const mathSize = (node.attrs.mathSize as string) || "normal";
  const renderRef = useRef<HTMLSpanElement>(null);
  const wrapperRef = useRef<HTMLElement>(null);

  // §perf-large-file heavy-block windowing (Phase 2): defer KaTeX render until
  // the node nears the viewport, mirroring mermaid/code. A selected node
  // bypasses the gate so find/nav into an unrendered atom still shows it.
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return onFirstVisible(el, () => setIsVisible(true));
  }, []);

  useEffect(() => {
    if ((!isVisible && !selected) || !renderRef.current || !formula) return;
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
  }, [formula, isVisible, selected]);

  return (
    <NodeViewWrapper
      as="span"
      className={`math-inline math-inline-rendered ${selected ? "math-inline-selected" : ""}`}
      contentEditable={false}
      // The render effect above returns before touching the DOM when there is
      // no formula, so an empty node stays empty forever. The export waits for
      // inline math to fill in (export-heavy-blocks.ts) and cannot tell "not
      // rendered yet" from "nothing to render" by looking — this says which.
      data-empty={formula ? undefined : "true"}
      data-math-size={mathSize}
      ref={wrapperRef}
    >
      <span ref={renderRef} />
    </NodeViewWrapper>
  );
}
