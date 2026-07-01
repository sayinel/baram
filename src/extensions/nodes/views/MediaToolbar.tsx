import React from "react";

interface MediaToolbarButtonProps {
  /** Highlight the button as toggled-on (e.g. caption editing active). */
  active?: boolean;
  children: React.ReactNode;
  /** Receives the click event; `e.currentTarget` is the button (AI anchor). */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
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

export function MediaToolbarButton({
  active = false,
  children,
  onClick,
  title,
}: MediaToolbarButtonProps): React.ReactElement {
  return (
    <button
      className={
        "media-toolbar-btn" + (active ? " media-toolbar-btn-active" : "")
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
