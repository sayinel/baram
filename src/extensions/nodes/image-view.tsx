// §3.3 Image NodeView — hover toolbar (resize, caption editing)
import { useState, useCallback, useRef, useMemo } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editor-store";

const RESIZE_OPTIONS = [
  { label: "25%", value: 25 },
  { label: "50%", value: 50 },
  { label: "75%", value: 75 },
  { label: "100%", value: 100 },
];

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

export function ImageView({
  node,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const rawSrc = node.attrs.src as string;
  const alt = (node.attrs.alt as string) || "";
  const title = (node.attrs.title as string) || "";
  const widthPercent = (node.attrs.widthPercent as number) || 100;

  // Resolve src for Tauri webview (memoize to avoid repeated conversion)
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const src = useMemo(() => resolveImageSrc(rawSrc), [rawSrc, activeTabId]);

  const [hovered, setHovered] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionText, setCaptionText] = useState(alt);
  const captionRef = useRef<HTMLInputElement>(null);

  // §5.1: Image click → NodeSelection is handled by the ProseMirror plugin
  // in image.ts (handleDOMEvents.mousedown). React handlers must NOT call
  // stopPropagation() because React 18 processes onMouseDown during the
  // capture phase on #root, which would block the event from reaching PM.

  const showToolbar = hovered || selected;

  const handleResize = useCallback(
    (percent: number) => {
      updateAttributes({ widthPercent: percent });
    },
    [updateAttributes],
  );

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
    >
      <figure
        className={`image-figure ${selected ? "image-selected" : ""}`}
        style={{ width: `${widthPercent}%` }}
      >
        <img
          src={src}
          alt={alt}
          title={title || undefined}
          draggable={false}
          data-drag-handle=""
        />

        {/* Hover toolbar */}
        {showToolbar && (
          <div className="image-toolbar" contentEditable={false}>
            {RESIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`image-toolbar-btn ${widthPercent === opt.value ? "image-toolbar-btn-active" : ""}`}
                onClick={() => handleResize(opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
            <span className="image-toolbar-sep" />
            <button
              className="image-toolbar-btn"
              onClick={startCaptionEdit}
              type="button"
            >
              Caption
            </button>
          </div>
        )}

        {/* Caption */}
        {editingCaption ? (
          <figcaption className="image-caption image-caption-editing">
            <input
              ref={captionRef}
              className="image-caption-input"
              value={captionText}
              onChange={(e) => setCaptionText(e.target.value)}
              onKeyDown={handleCaptionKeyDown}
              onBlur={handleCaptionSave}
              placeholder="Add caption..."
            />
          </figcaption>
        ) : alt ? (
          <figcaption
            className="image-caption"
            onClick={startCaptionEdit}
            contentEditable={false}
          >
            {alt}
          </figcaption>
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}
