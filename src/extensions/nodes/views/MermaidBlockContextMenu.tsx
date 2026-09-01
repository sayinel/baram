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

interface MermaidBlockContextMenuProps {
  code: string;
  contextMenu: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
  onOpenEditFullscreen: () => void;
  setViewFullscreen: (value: boolean) => void;
  svgHtml: string;
}

export function MermaidBlockContextMenu({
  code,
  contextMenu,
  onClose,
  onDelete,
  onOpenEditFullscreen,
  setViewFullscreen,
  svgHtml,
}: MermaidBlockContextMenuProps): React.ReactPortal {
  return createPortal(
    <div
      className="mermaid-context-menu"
      // Stop click from bubbling through the React portal tree to the
      // NodeViewWrapper's onClick (which would select the block → edit mode).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: contextMenu.x,
        top: contextMenu.y,
        zIndex: 9999,
      }}
    >
      {svgHtml && (
        <>
          <button
            className="mermaid-context-menu-item"
            onClick={() => {
              copyMermaidSvg(svgHtml);
              onClose();
            }}
          >
            Copy as SVG
          </button>
          <button
            className="mermaid-context-menu-item"
            onClick={() => {
              copyMermaidPng(code);
              onClose();
            }}
          >
            Copy as PNG
          </button>
          <button
            className="mermaid-context-menu-item"
            onClick={() => {
              void downloadMermaidPng(code);
              onClose();
            }}
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
