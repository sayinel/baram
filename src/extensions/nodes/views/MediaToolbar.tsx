import React from "react";

import type { Placement } from "@floating-ui/dom";

import { Tooltip } from "../../../components/Tooltip";

interface MediaToolbarButtonProps {
  /** Highlight the button as toggled-on (e.g. caption editing active). */
  active?: boolean;
  children: React.ReactNode;
  /**
   * The hover label, already translated.
   *
   * Named `label` rather than `title` because it no longer becomes a `title` attribute: the
   * app's own pill shows it (see below), and a leftover native `title` would double up — the
   * browser's own label arriving a second later, under the one already on screen.
   */
  label: string;
  /** Receives the click event; `e.currentTarget` is the button (AI anchor). */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  placement?: Placement;
}

/**
 * Shared hover toolbar for media blocks (SVG §5.1, Mermaid §5.5, image §3.3).
 *
 * A light, top-right pill of icon buttons revealed on hover of the block. It
 * must live inside a `position: relative` block container; reveal is driven by
 * CSS (`.{block}:hover .media-toolbar`). The container swallows `mousedown` so
 * clicking a button never reaches ProseMirror to select/edit the block.
 */
export function MediaToolbar({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="media-toolbar"
      contentEditable={false}
      ref={(el) => {
        if (el) el.onmousedown = (e) => e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

/**
 * One icon button, labelled by the app's hover pill rather than by `title`.
 *
 * ‼️ `Tooltip` is what makes these buttons readable at all. They are icon-only and appear only
 * while the pointer is already inside the block, so a native `title`'s ~1s WebKit delay lands
 * after the pointer has moved on — the label existed and nobody ever saw it. The pill is also
 * this button's accessible name, which a `title` was not reliably giving it.
 *
 * Default placement is below: the toolbar hugs the block's TOP-right corner, so a pill above it
 * would sit over the previous block and is the first thing clipped at the top of the viewport.
 */
export function MediaToolbarButton({
  active = false,
  children,
  label,
  onClick,
  placement = "bottom",
}: MediaToolbarButtonProps): React.ReactElement {
  return (
    <Tooltip label={label} placement={placement}>
      <button
        className={
          "media-toolbar-btn" + (active ? " media-toolbar-btn-active" : "")
        }
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}
