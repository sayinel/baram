// §3.3 Image NodeView — hover toolbar (resize, caption editing)
import { useState, useCallback, useRef } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

const RESIZE_OPTIONS = [
  { label: "25%", value: 25 },
  { label: "50%", value: 50 },
  { label: "75%", value: 75 },
  { label: "100%", value: 100 },
];

export function ImageView({
  node,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const src = node.attrs.src as string;
  const alt = (node.attrs.alt as string) || "";
  const title = (node.attrs.title as string) || "";
  const widthPercent = (node.attrs.widthPercent as number) || 100;

  const [hovered, setHovered] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionText, setCaptionText] = useState(alt);
  const captionRef = useRef<HTMLInputElement>(null);

  const showToolbar = hovered || selected;

  const handleResize = useCallback(
    (percent: number) => {
      updateAttributes({ widthPercent: percent });
    },
    [updateAttributes],
  );

  const handleCaptionSave = useCallback(() => {
    updateAttributes({ alt: captionText });
    setEditingCaption(false);
  }, [updateAttributes, captionText]);

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
      data-drag-handle=""
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
