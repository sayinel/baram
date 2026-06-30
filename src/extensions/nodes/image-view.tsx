// §3.3 Image NodeView — edge-drag resize, caption editing, AI menu
import { useCallback, useMemo, useRef, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Sparkles } from "lucide-react";

import { useEditorStore } from "../../stores/editor/editor";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { useMediaResize } from "./views/use-media-resize";

export function ImageView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const rawSrc = node.attrs.src as string;
  const alt = (node.attrs.alt as string) || "";
  const title = (node.attrs.title as string) || "";
  const widthPercent = (node.attrs.widthPercent as number) || 100;

  // Resolve src for Tauri webview (memoize to avoid repeated conversion)
  const src = useMemo(() => resolveImageSrc(rawSrc), [rawSrc]);

  // §56d: Show caption placeholder for journal photo assets
  const isJournalAsset = /assets\/\d{4}-\d{2}\//.test(rawSrc);

  const [hovered, setHovered] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionText, setCaptionText] = useState(alt);
  const captionRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // §5.1: Image click → NodeSelection is handled by the ProseMirror plugin
  // in image.ts (handleDOMEvents.mousedown). React handlers must NOT call
  // stopPropagation() because React 18 processes onMouseDown during the
  // capture phase on #root, which would block the event from reaching PM.

  const showToolbar = hovered || selected;

  // Edge-drag resize (Notion-style), shared with the SVG/Mermaid blocks. The
  // figure is centered, so the same centre-distance maths apply; width persists
  // to the widthPercent attr (already serialized to `<img width="X%">`).
  const { dragPct, startResize } = useMediaResize(containerRef, (pct) => {
    updateAttributes({ widthPercent: pct });
  });
  const effectiveWidth = dragPct ?? widthPercent;

  const handleCaptionSave = useCallback(() => {
    setEditingCaption(false);
    // Only update if changed; defer to let ProseMirror's selection settle first
    if (captionText !== alt) {
      requestAnimationFrame(() => {
        updateAttributes({ alt: captionText });
      });
    }
  }, [updateAttributes, captionText, alt]);

  const handleCaptionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCaptionSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCaptionText(alt);
        setEditingCaption(false);
      }
    },
    [handleCaptionSave, alt],
  );

  const startCaptionEdit = useCallback(() => {
    setCaptionText(alt);
    setEditingCaption(true);
    setTimeout(() => captionRef.current?.focus(), 0);
  }, [alt]);

  return (
    <NodeViewWrapper
      className="image-node-view"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={containerRef}
    >
      <figure
        className={`image-figure ${selected ? "image-selected" : ""}`}
        style={{ width: `${effectiveWidth}%` }}
      >
        <img
          alt={alt}
          data-drag-handle=""
          draggable={false}
          src={src}
          title={title || undefined}
        />

        {/* Edge resize handles */}
        <div
          className="media-resize-handle media-resize-handle-left"
          onMouseDown={startResize}
          title="Drag to resize"
        />
        <div
          className="media-resize-handle media-resize-handle-right"
          onMouseDown={startResize}
          title="Drag to resize"
        />
        {dragPct != null && (
          <div className="media-resize-label">{dragPct}%</div>
        )}

        {/* Hover toolbar */}
        {showToolbar && (
          <div className="image-toolbar" contentEditable={false}>
            <button
              className="image-toolbar-btn"
              onClick={startCaptionEdit}
              type="button"
            >
              Caption
            </button>
            <span className="image-toolbar-sep" />
            <button
              className="image-toolbar-btn"
              onClick={(e) => {
                const context =
                  [
                    alt && `Alt: ${alt}`,
                    title && `Title: ${title}`,
                    rawSrc && `Source: ${rawSrc}`,
                  ]
                    .filter(Boolean)
                    .join("\n") || "image";
                const pos = getPos();
                if (typeof pos !== "number") return;
                showNodeViewAIMenu(
                  e.currentTarget,
                  "image",
                  context,
                  editor,
                  pos,
                );
              }}
              ref={(el) => {
                if (el) el.onmousedown = (e) => e.stopPropagation();
              }}
              type="button"
            >
              <Sparkles size={14} />
            </button>
          </div>
        )}

        {/* Caption */}
        {editingCaption ? (
          <figcaption className="image-caption image-caption-editing">
            <input
              className="image-caption-input"
              onBlur={handleCaptionSave}
              onChange={(e) => setCaptionText(e.target.value)}
              onKeyDown={handleCaptionKeyDown}
              placeholder="Add caption..."
              ref={captionRef}
              value={captionText}
            />
          </figcaption>
        ) : alt ? (
          <figcaption
            className="image-caption"
            contentEditable={false}
            onClick={startCaptionEdit}
          >
            {alt}
          </figcaption>
        ) : isJournalAsset ? (
          <figcaption
            className="image-caption image-caption-placeholder"
            contentEditable={false}
            onClick={startCaptionEdit}
          >
            캡션 추가...
          </figcaption>
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}

/** Check if src is a remote URL or data URI (no conversion needed) */
function isRemoteOrData(src: string): boolean {
  return /^https?:\/\/|^data:/i.test(src);
}

/** Resolve image src for Tauri webview.
 *  - Remote URLs and data URIs pass through unchanged.
 *  - Local paths (absolute or relative) are converted via Tauri's asset protocol.
 */
function resolveImageSrc(src: string): string {
  if (!src || isRemoteOrData(src)) return src;

  // Resolve relative path against the current file's directory
  let absolutePath = src;
  if (!src.startsWith("/")) {
    const activeTabId = useEditorStore.getState().activeTabId;
    const tabs = useEditorStore.getState().tabs;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const filePath = activeTab?.filePath;
    if (filePath) {
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      absolutePath = `${dir}/${src}`;
    }
  }

  return convertFileSrc(absolutePath);
}
