// §3.3 Image NodeView — hover toolbar (resize, caption editing)
import { useState, useCallback, useRef, useMemo } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editor-store";

const RESIZE_PRESETS = [25, 50, 75, 100];

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

export function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
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
  const [editingSize, setEditingSize] = useState(false);
  const [sizeInput, setSizeInput] = useState(String(widthPercent));
  const captionRef = useRef<HTMLInputElement>(null);
  const sizeInputRef = useRef<HTMLInputElement>(null);

  // §5.1: Image click → NodeSelection is handled by the ProseMirror plugin
  // in image.ts (handleDOMEvents.mousedown). React handlers must NOT call
  // stopPropagation() because React 18 processes onMouseDown during the
  // capture phase on #root, which would block the event from reaching PM.

  const showToolbar = hovered || selected;

  const handleResize = useCallback(
    (percent: number) => {
      const clamped = Math.max(10, Math.min(100, percent));
      updateAttributes({ widthPercent: clamped });
      setSizeInput(String(clamped));
      setEditingSize(false);
    },
    [updateAttributes],
  );

  const startSizeEdit = useCallback(() => {
    setSizeInput(String(widthPercent));
    setEditingSize(true);
    setTimeout(() => sizeInputRef.current?.select(), 0);
  }, [widthPercent]);

  const commitSizeInput = useCallback(() => {
    const val = parseInt(sizeInput, 10);
    if (!isNaN(val) && val >= 10 && val <= 100) {
      handleResize(val);
    } else {
      setSizeInput(String(widthPercent));
    }
    setEditingSize(false);
  }, [sizeInput, widthPercent, handleResize]);

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
            {RESIZE_PRESETS.map((pct) => (
              <button
                key={pct}
                className={`image-toolbar-btn ${widthPercent === pct ? "image-toolbar-btn-active" : ""}`}
                onClick={() => handleResize(pct)}
                type="button"
              >
                {pct}%
              </button>
            ))}
            <span className="image-toolbar-sep" />
            {editingSize ? (
              <span className="image-size-input-wrap">
                <input
                  ref={sizeInputRef}
                  className="image-size-input"
                  type="number"
                  min={10}
                  max={100}
                  value={sizeInput}
                  onChange={(e) => setSizeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitSizeInput();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingSize(false);
                      setSizeInput(String(widthPercent));
                    }
                  }}
                  onBlur={commitSizeInput}
                />
                <span className="image-size-unit">%</span>
              </span>
            ) : (
              <button
                className={`image-toolbar-btn ${!RESIZE_PRESETS.includes(widthPercent) ? "image-toolbar-btn-active" : ""}`}
                onClick={startSizeEdit}
                type="button"
                title="커스텀 크기 입력"
              >
                {RESIZE_PRESETS.includes(widthPercent)
                  ? "Custom"
                  : `${widthPercent}%`}
              </button>
            )}
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
        ) : isJournalAsset ? (
          <figcaption
            className="image-caption image-caption-placeholder"
            onClick={startCaptionEdit}
            contentEditable={false}
          >
            캡션 추가...
          </figcaption>
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}
