// §5.5 Mermaid Block — right-click context menu (moved out of
// mermaid-block-view.tsx §perf-large-file file-size split). Zero-hook: the
// parent owns all state; this only renders the portal and wires callbacks.

import React from "react";
import { createPortal } from "react-dom";

import {
  copyMermaidPng,
  copyMermaidSource,
  copyMermaidSvg,
  downloadMermaidPng,
} from "../../../utils/markdown/mermaid-utils";
import { runBlockAction } from "./run-block-action";

interface MermaidBlockContextMenuProps {
  code: string;
  contextMenu: { x: number; y: number };
  /** The hook's ref for the menu root — exempts it from the capture-phase
   *  dismiss by identity (issue 542, use-block-context-menu.ts). */
  menuRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDelete: () => void;
  onOpenEditFullscreen: () => void;
  setViewFullscreen: (value: boolean) => void;
  /** The rendered svg for `code`, or "" when there is none for it. */
  svgHtml: string;
  /** Why `svgHtml` is "" while there is a source ("Rendering…", or the
   *  diagram does not render): the svg items stay in place, disabled, with
   *  this as their tooltip, so the list does not reshape when a render
   *  lands. Undefined when there is nothing to offer at all (empty source),
   *  which hides them. */
  svgUnavailableReason?: string;
}

export function MermaidBlockContextMenu({
  code,
  contextMenu,
  menuRef,
  onClose,
  onDelete,
  onOpenEditFullscreen,
  setViewFullscreen,
  svgHtml,
  svgUnavailableReason,
}: MermaidBlockContextMenuProps): React.ReactPortal {
  const svgItems = svgHtml !== "" || svgUnavailableReason !== undefined;
  const svgDisabled = svgHtml === "";
  const svgTitle = svgDisabled ? svgUnavailableReason : undefined;
  return createPortal(
    <div
      className="mermaid-context-menu"
      // Stop click from bubbling through the React portal tree to the
      // NodeViewWrapper's onClick (which would select the block → edit mode).
      onClick={(e) => e.stopPropagation()}
      // issue 521: a right-click on the menu itself is nobody's — not the
      // browser's (the menu is a portal, so the block's containment guard
      // passes it up) and not a reason to move the menu.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      // issue 542: the mounted root is exempt from the capture-phase dismiss,
      // by identity (use-block-context-menu.ts).
      ref={menuRef}
      style={{
        position: "fixed",
        left: contextMenu.x,
        top: contextMenu.y,
        zIndex: 9999,
      }}
    >
      {svgItems && (
        <>
          <button
            className="mermaid-context-menu-item"
            disabled={svgDisabled}
            onClick={() => {
              copyMermaidSvg(svgHtml);
              onClose();
            }}
            title={svgTitle}
          >
            Copy as SVG
          </button>
          <button
            className="mermaid-context-menu-item"
            disabled={svgDisabled}
            onClick={() => {
              runBlockAction("Mermaid block", "copy as PNG", () =>
                copyMermaidPng(code),
              );
              onClose();
            }}
            title={svgTitle}
          >
            Copy as PNG
          </button>
          <button
            className="mermaid-context-menu-item"
            disabled={svgDisabled}
            onClick={() => {
              runBlockAction("Mermaid block", "download PNG", () =>
                downloadMermaidPng(code),
              );
              onClose();
            }}
            title={svgTitle}
          >
            Download PNG
          </button>
        </>
      )}
      <button
        className="mermaid-context-menu-item"
        onClick={() => {
          copyMermaidSource(code);
          onClose();
        }}
      >
        Copy Source
      </button>
      <div className="mermaid-context-menu-divider" />
      <button
        className="mermaid-context-menu-item"
        onClick={() => {
          setViewFullscreen(true);
          onClose();
        }}
      >
        View Fullscreen
      </button>
      <button
        className="mermaid-context-menu-item"
        onClick={() => {
          onOpenEditFullscreen();
          onClose();
        }}
      >
        Edit Fullscreen
      </button>
      <button
        className="mermaid-context-menu-item mermaid-context-menu-danger"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}
