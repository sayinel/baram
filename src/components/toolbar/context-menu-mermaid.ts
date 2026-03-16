import type { MenuItem } from "./context-menu-types";
// §4.8 Context Menu — mermaid block menu builder
import type { Editor } from "@tiptap/react";

import {
  copyMermaidPng,
  copyMermaidSource,
  copyMermaidSvg,
} from "../../utils/markdown/mermaid-utils";

/** Build context menu items for a mermaidBlock node from a DOM target. */
export function buildMermaidBlockMenu(
  editor: Editor,
  target: Element,
): MenuItem[] {
  // Find the mermaid NodeView wrapper (target may be SVGElement inside the diagram)
  const wrapper = target.closest(
    "[data-type='mermaidBlock']",
  ) as HTMLElement | null;
  if (!wrapper) return [];

  const pmPos = editor.view.posAtDOM(wrapper, 0);
  const node = editor.state.doc.nodeAt(pmPos);
  if (!node || node.type.name !== "mermaidBlock") return [];

  const code = (node.attrs.code as string) || "";

  // Extract rendered SVG from the NodeView DOM
  const svgContainer = wrapper.querySelector(".mermaid-block-svg");
  const svgHtml = svgContainer?.innerHTML || "";

  return [
    {
      label: "Copy as SVG",
      action: () => {
        if (svgHtml) copyMermaidSvg(svgHtml);
      },
    },
    {
      label: "Copy as PNG",
      action: () => {
        if (svgHtml) copyMermaidPng(svgHtml);
      },
    },
    {
      label: "Copy Mermaid Source",
      action: () => copyMermaidSource(code),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Edit Full-screen",
      action: () => {
        editor.commands.setNodeSelection(pmPos);
        // Dispatch custom event for full-screen editing
        wrapper.dispatchEvent(
          new CustomEvent("mermaid-fullscreen", { bubbles: true }),
        );
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Delete Diagram",
      action: () => {
        const { tr } = editor.state;
        tr.delete(pmPos, pmPos + node.nodeSize);
        editor.view.dispatch(tr);
      },
    },
  ];
}
