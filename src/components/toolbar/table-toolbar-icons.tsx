// §5.5 — the table toolbar's inline SVG glyphs (16×16, stroke-based). Split
// from TableToolbar.tsx, which draws them.
import type { ReactNode } from "react";

const ICON_SIZE = 16;
const S = {
  xmlns: "http://www.w3.org/2000/svg",
  width: ICON_SIZE,
  height: ICON_SIZE,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
};

// Merge cells icon: 3×2 grid, middle row merged into one cell
export const MergeCellsIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.3}>
    {/* Outer border */}
    <rect height="12" rx="1" width="12" x="2" y="2" />
    {/* Horizontal row dividers (3 rows) */}
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    {/* Vertical column divider — top and bottom rows only (middle row merged) */}
    <line x1="8" x2="8" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    {/* Highlight merged middle row */}
    <rect
      fill="currentColor"
      height="3.5"
      opacity="0.25"
      rx="0.3"
      stroke="none"
      width="11"
      x="2.5"
      y="6.3"
    />
  </svg>
);
// Split cell icon: 3×2 grid, middle row has dashed vertical divider
export const SplitCellsIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.3}>
    {/* Outer border */}
    <rect height="12" rx="1" width="12" x="2" y="2" />
    {/* Horizontal row dividers (3 rows) */}
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    {/* Vertical column divider — top and bottom rows solid */}
    <line x1="8" x2="8" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    {/* Middle row: dashed divider (about to split) */}
    <line strokeDasharray="1.5 1.5" x1="8" x2="8" y1="6" y2="10" />
  </svg>
);
// Delete row icon: table row with X
export const DeleteRowIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="12" rx="1" width="12" x="2" y="2" />
    <line x1="2" x2="14" y1="6" y2="6" />
    <line x1="2" x2="14" y1="10" y2="10" />
    {/* X mark on middle row */}
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="5"
      x2="11"
      y1="6.5"
      y2="9.5"
    />
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="11"
      x2="5"
      y1="6.5"
      y2="9.5"
    />
  </svg>
);
// Delete column icon: table column with X
export const DeleteColIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.4}>
    <rect height="12" rx="1" width="12" x="2" y="2" />
    <line x1="6" x2="6" y1="2" y2="14" />
    <line x1="10" x2="10" y1="2" y2="14" />
    {/* X mark on middle column */}
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="6.5"
      x2="9.5"
      y1="5"
      y2="11"
    />
    <line
      stroke="currentColor"
      strokeWidth={1.8}
      x1="9.5"
      x2="6.5"
      y1="5"
      y2="11"
    />
  </svg>
);
// Overflow icon: horizontal three-dot "more" glyph
export const MoreIcon = (): ReactNode => (
  <svg {...S} strokeWidth={1.6}>
    <circle cx="3.5" cy="8" fill="currentColor" r="1.1" stroke="none" />
    <circle cx="8" cy="8" fill="currentColor" r="1.1" stroke="none" />
    <circle cx="12.5" cy="8" fill="currentColor" r="1.1" stroke="none" />
  </svg>
);
