import React, { useCallback, useEffect, useRef, useState } from "react";

interface BlockCaptionProps {
  /** Commit a new caption (trimmed; empty string clears it). */
  onCommit: (text: string) => void;
  placeholder?: string;
  value: null | string;
}

/**
 * Caption shown below a media block (SVG / Mermaid), centered and muted, with
 * click-to-edit inline. When empty it renders a hover-revealed placeholder so
 * the affordance is discoverable. Mirrors the image block's caption UX.
 */
export function BlockCaption({
  onCommit,
  placeholder = "Add caption…",
  value,
}: BlockCaptionProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the local draft in sync with external changes while not editing.
  useEffect(() => {
    if (!editing) setText(value ?? "");
  }, [value, editing]);

  const startEdit = useCallback(() => {
    setText(value ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const next = text.trim();
    if (next !== (value ?? "")) onCommit(next);
  }, [text, value, onCommit]);

  if (editing) {
    return (
      <div
        className="block-caption block-caption-editing"
        contentEditable={false}
      >
        <input
          className="block-caption-input"
          onBlur={commit}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setText(value ?? "");
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          ref={inputRef}
          value={text}
        />
      </div>
    );
  }

  return (
    <div
      className={"block-caption" + (value ? "" : " block-caption-placeholder")}
      contentEditable={false}
      onClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
    >
      {value || placeholder}
    </div>
  );
}
