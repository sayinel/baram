import type { MenuItem } from "./context-menu-types";
// §4.8 Context Menu — math node menu builders
import type { Editor } from "@tiptap/react";

import { copyMathToPNG } from "../../utils/katex/katex-to-png";

/** Build context menu items for a mathBlock node at `pos`. */
export function buildMathBlockMenu(editor: Editor, pos: number): MenuItem[] {
  const resolved = editor.state.doc.resolve(pos);
  // atom:true — find the mathBlock node via nodeAt or nodeAfter
  let mathNode = editor.state.doc.nodeAt(pos);
  let mathPos = pos;
  if (!mathNode || mathNode.type.name !== "mathBlock") {
    mathNode = resolved.nodeAfter;
    mathPos = pos;
  }
  if (!mathNode || mathNode.type.name !== "mathBlock") {
    mathNode = resolved.parent;
    mathPos = resolved.before();
  }

  const formula = (mathNode.attrs.formula as string) || "";
  const currentSize = (mathNode.attrs.mathSize as string) || "normal";

  return [
    {
      label: "Copy LaTeX Source",
      action: () => navigator.clipboard.writeText(formula),
    },
    {
      label: "Copy as Image",
      action: () => {
        copyMathToPNG(formula, true);
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: `Size: Small${currentSize === "small" ? " \u2713" : ""}`,
      action: () => {
        const tr = editor.state.tr;
        tr.setNodeMarkup(mathPos, undefined, {
          ...mathNode.attrs,
          mathSize: "small",
        });
        editor.view.dispatch(tr);
      },
    },
    {
      label: `Size: Normal${currentSize === "normal" ? " \u2713" : ""}`,
      action: () => {
        const tr = editor.state.tr;
        tr.setNodeMarkup(mathPos, undefined, {
          ...mathNode.attrs,
          mathSize: "normal",
        });
        editor.view.dispatch(tr);
      },
    },
    {
      label: `Size: Large${currentSize === "large" ? " \u2713" : ""}`,
      action: () => {
        const tr = editor.state.tr;
        tr.setNodeMarkup(mathPos, undefined, {
          ...mathNode.attrs,
          mathSize: "large",
        });
        editor.view.dispatch(tr);
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Convert to Inline Math",
      action: () => {
        const tr = editor.state.tr;
        const mathInlineType = editor.schema.nodes.mathInline;
        if (!mathInlineType) return;
        const inlineNode = mathInlineType.create({ formula });
        tr.replaceWith(mathPos, mathPos + mathNode.nodeSize, inlineNode);
        editor.view.dispatch(tr);
      },
    },
    {
      label: "Delete Equation",
      action: () => {
        const tr = editor.state.tr;
        tr.delete(mathPos, mathPos + mathNode.nodeSize);
        editor.view.dispatch(tr);
      },
    },
  ];
}

/** Build context menu items for a mathInline node from a DOM target. */
export function buildMathInlineMenu(
  editor: Editor,
  target: HTMLElement,
): MenuItem[] {
  // Find the inline math node by walking the DOM to get ProseMirror position
  const nodeViewWrapper = target.closest(
    "[data-type='mathInline']",
  ) as HTMLElement | null;
  if (!nodeViewWrapper) return [];

  const pmPos = editor.view.posAtDOM(nodeViewWrapper, 0);
  const resolved = editor.state.doc.resolve(pmPos);
  // For atom inline nodes, check nodeAfter at the resolved position
  const inlineNode = resolved.nodeAfter ?? resolved.parent;
  const isInlineAtom = inlineNode.type.name === "mathInline";
  const mathNode = isInlineAtom ? inlineNode : resolved.parent;
  const nodePos = isInlineAtom ? pmPos : resolved.before();

  const formula = (mathNode.attrs.formula as string) || "";
  const currentSize = (mathNode.attrs.mathSize as string) || "normal";

  return [
    {
      label: "Copy LaTeX Source",
      action: () => navigator.clipboard.writeText(formula),
    },
    {
      label: "Copy as Image",
      action: () => {
        copyMathToPNG(formula, false);
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: `Size: Small${currentSize === "small" ? " \u2713" : ""}`,
      action: () => {
        const tr = editor.state.tr;
        tr.setNodeMarkup(nodePos, undefined, {
          ...mathNode.attrs,
          mathSize: "small",
        });
        editor.view.dispatch(tr);
      },
    },
    {
      label: `Size: Normal${currentSize === "normal" ? " \u2713" : ""}`,
      action: () => {
        const tr = editor.state.tr;
        tr.setNodeMarkup(nodePos, undefined, {
          ...mathNode.attrs,
          mathSize: "normal",
        });
        editor.view.dispatch(tr);
      },
    },
    {
      label: `Size: Large${currentSize === "large" ? " \u2713" : ""}`,
      action: () => {
        const tr = editor.state.tr;
        tr.setNodeMarkup(nodePos, undefined, {
          ...mathNode.attrs,
          mathSize: "large",
        });
        editor.view.dispatch(tr);
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Convert to Block Math",
      action: () => {
        const tr = editor.state.tr;
        const mathBlockType = editor.schema.nodes.mathBlock;
        if (!mathBlockType) return;
        // atom:true — formula in attrs, no text children
        const blockNode = mathBlockType.create({ formula });
        tr.replaceWith(nodePos, nodePos + mathNode.nodeSize, blockNode);
        editor.view.dispatch(tr);
      },
    },
    {
      label: "Delete Equation",
      action: () => {
        const tr = editor.state.tr;
        tr.delete(nodePos, nodePos + mathNode.nodeSize);
        editor.view.dispatch(tr);
      },
    },
  ];
}
