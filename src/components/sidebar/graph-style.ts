// §30 Graph View — cytoscape stylesheet builder
import type { GraphColors } from "./graph-colors";
import type cytoscape from "cytoscape";
import type { StylesheetStyle } from "cytoscape";

/**
 * Build the dynamic Cytoscape stylesheet from settings and the resolved theme colours.
 *
 * ‼️ Every colour must arrive as a literal. Cytoscape parses colours itself and rejects a
 * `var()` string outright, falling back to its own default — see graph-colors.ts, which is
 * where `colors` comes from.
 */
export function buildGraphStyle(
  settings: {
    colorByNamespace: boolean;
    linkThickness: number;
    showArrows: boolean;
  },
  colors: GraphColors,
): StylesheetStyle[] {
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
        "background-color": colors.node,
        width: "data(size)",
        height: "data(size)",
        color: colors.label,
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
        "background-color": colors.active,
        "border-width": 2,
        "border-color": colors.activeBorder,
        "background-blacken": 0,
      } as cytoscape.Css.Node,
    },
    {
      selector: "node.active",
      style: {
        "background-color": colors.active,
        "border-width": 2,
        "border-color": colors.activeBorder,
      },
    },
    {
      selector: "node.neighbor",
      style: {
        "background-color": colors.neighbor,
      },
    },
    {
      selector: "node.orphan",
      style: {
        "background-color": colors.orphan,
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
        "border-color": colors.node,
        "border-style": "dashed" as never,
      },
    },
    {
      selector: "node[?isTag]",
      style: {
        shape: "diamond",
        "background-color": colors.tag,
        "font-size": 9,
        "text-valign": "bottom",
        "text-margin-y": 6,
      } as cytoscape.Css.Node,
    },
    {
      selector: "edge",
      style: {
        width: settings.linkThickness,
        "line-color": colors.edge,
        "curve-style": "bezier",
        "target-arrow-shape": settings.showArrows ? "triangle" : "none",
        "target-arrow-color": colors.edge,
        "arrow-scale": 0.6,
        opacity: 0.5,
        "transition-property": "opacity, line-color, width",
        "transition-duration": 150,
      } as cytoscape.Css.Edge,
    },
    {
      selector: "edge.highlighted",
      style: {
        "line-color": colors.active,
        "target-arrow-color": colors.active,
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
        "border-color": colors.activeBorder,
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
        "border-color": colors.pinned,
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
        "border-color": colors.activeBorder,
        "z-index": 10,
      },
    },
    {
      selector: "node.hover-neighbor",
      style: {
        opacity: 1,
        "border-width": 1,
        "border-color": colors.neighbor,
      },
    },
    {
      selector: "edge.hover-edge",
      style: {
        opacity: 0.8,
        "line-color": colors.active,
        "target-arrow-color": colors.active,
        width: Math.max(settings.linkThickness * 1.5, 1.5),
      },
    },
    // §87 Cross-vault edges: dashed line
    {
      selector: "edge[?crossVault]",
      style: {
        "line-style": "dashed",
        "line-dash-pattern": [6, 3],
        "line-color": colors.crossVault,
        "target-arrow-color": colors.crossVault,
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
