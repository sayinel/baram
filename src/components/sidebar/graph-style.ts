// §30 Graph View — cytoscape stylesheet builder
import type cytoscape from "cytoscape";
import type { StylesheetStyle } from "cytoscape";

/** Build dynamic Cytoscape stylesheet from settings */
export function buildGraphStyle(settings: {
  colorByNamespace: boolean;
  linkThickness: number;
  showArrows: boolean;
}): StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 10,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-max-width": "80px",
        "text-wrap": "ellipsis",
        "background-color": "var(--graph-node-color, #6b7280)",
        width: "data(size)",
        height: "data(size)",
        color: "var(--graph-label-color, #d1d5db)",
        "transition-property":
          "opacity, border-width, border-color, background-color",
        "transition-duration": 150,
      } as cytoscape.Css.Node,
    },
    // §61 Namespace coloring — uses data(nsColor) set per-node
    ...(settings.colorByNamespace
      ? [
          {
            selector: "node[nsColor]",
            style: {
              "background-color": "data(nsColor)",
            } as cytoscape.Css.Node,
          },
        ]
      : []),
    {
      selector: "node:selected",
      style: {
        "background-color": "var(--graph-active-color, #3b82f6)",
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
        "background-blacken": 0,
      } as cytoscape.Css.Node,
    },
    {
      selector: "node.active",
      style: {
        "background-color": "var(--graph-active-color, #3b82f6)",
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
      },
    },
    {
      selector: "node.neighbor",
      style: {
        "background-color": "var(--graph-neighbor-color, #8b5cf6)",
      },
    },
    {
      selector: "node.orphan",
      style: {
        "background-color": "var(--graph-orphan-color, #4b5563)",
        opacity: 0.6,
      },
    },
    // §87 Multi-vault: color nodes by vault context color
    {
      selector: "node[vaultColor]",
      style: {
        "background-color": "data(vaultColor)",
      } as cytoscape.Css.Node,
    },
    {
      selector: "node[?isGhost]",
      style: {
        "background-color": "transparent",
        "border-width": 1.5,
        "border-color": "var(--graph-node-color, #6b7280)",
        "border-style": "dashed" as never,
      },
    },
    {
      selector: "node[?isTag]",
      style: {
        shape: "diamond",
        "background-color": "var(--color-graph-tag, #f59e0b)",
        "font-size": 9,
        "text-valign": "bottom",
        "text-margin-y": 6,
      } as cytoscape.Css.Node,
    },
    {
      selector: "edge",
      style: {
        width: settings.linkThickness,
        "line-color": "var(--graph-edge-color, #374151)",
        "curve-style": "bezier",
        "target-arrow-shape": settings.showArrows ? "triangle" : "none",
        "target-arrow-color": "var(--graph-edge-color, #374151)",
        "arrow-scale": 0.6,
        opacity: 0.5,
        "transition-property": "opacity, line-color, width",
        "transition-duration": 150,
      } as cytoscape.Css.Edge,
    },
    {
      selector: "edge.highlighted",
      style: {
        "line-color": "var(--graph-active-color, #3b82f6)",
        "target-arrow-color": "var(--graph-active-color, #3b82f6)",
        opacity: 1,
        width: Math.max(settings.linkThickness * 2, 2),
      },
    },
    // §30.3a Search highlight (defined before hover so hover wins during it)
    {
      selector: "node.search-match",
      style: {
        opacity: 1,
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
        "z-index": 9,
      },
    },
    {
      selector: "node.search-dim",
      style: {
        opacity: 0.15,
      },
    },
    {
      selector: "edge.search-dim",
      style: {
        opacity: 0.08,
      },
    },
    // §30.3c Pinned nodes
    {
      selector: "node.pinned",
      style: {
        "border-width": 2,
        "border-color": "var(--graph-pinned-color, #f59e0b)",
        "border-style": "double" as never,
      },
    },
    // Hover effects
    {
      selector: "node.faded",
      style: {
        opacity: 0.15,
      },
    },
    {
      selector: "edge.faded",
      style: {
        opacity: 0.08,
      },
    },
    {
      selector: "node.hover",
      style: {
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
        "z-index": 10,
      },
    },
    {
      selector: "node.hover-neighbor",
      style: {
        opacity: 1,
        "border-width": 1,
        "border-color": "var(--graph-neighbor-color, #8b5cf6)",
      },
    },
    {
      selector: "edge.hover-edge",
      style: {
        opacity: 0.8,
        "line-color": "var(--graph-active-color, #3b82f6)",
        "target-arrow-color": "var(--graph-active-color, #3b82f6)",
        width: Math.max(settings.linkThickness * 1.5, 1.5),
      },
    },
    // §87 Cross-vault edges: dashed line
    {
      selector: "edge[?crossVault]",
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [6, 3],
        "line-color": "var(--graph-cross-vault-edge, #8b5cf6)",
        "target-arrow-color": "var(--graph-cross-vault-edge, #8b5cf6)",
        opacity: 0.6,
      } as cytoscape.Css.Edge,
    },
    // Zoom label fade
    {
      selector: "node.labels-hidden",
      style: {
        "text-opacity": 0,
      },
    },
  ];
}
