import React, { useCallback, useEffect, useRef, useState } from "react";

interface BlockCaptionProps {
  /** Whether the caption is in edit mode — controlled by the parent so the
   *  block's hover toolbar (Caption button) can trigger editing. */
  editing: boolean;
  /** Commit a new caption (trimmed; empty string clears it). */
  onCommit: (text: string) => void;
  /** Request an editing-state change (enter on toolbar/click, leave on commit). */
  onEditingChange: (editing: boolean) => void;
  placeholder?: string;
  value: null | string;
}

/**
 * Caption shown below a media block (SVG / Mermaid), centered and muted.
 *
 * Editing is parent-controlled: the block's toolbar Caption button flips
 * `editing`, and clicking an existing caption requests edit too. When there is
 * no caption and we are not editing, this renders nothing — the toolbar button
 * is the "add caption" affordance (mirrors the image block's caption UX).
 */
export function BlockCaption({
  editing,
  onCommit,
  onEditingChange,
  placeholder = "Add caption…",
  value,
}: BlockCaptionProps): null | React.ReactElement {
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  // Read latest value at the moment editing turns on without re-seeding the
  // draft mid-edit (which would clobber what the user is typing).
  const valueRef = useRef(value);
  valueRef.current = value;

  // Stop the native mousedown so clicking the caption never reaches
  // ProseMirror to select the block (which would unmount us mid-edit). Mirrors
  // the hover toolbar's approach; React's onClick stop alone is insufficient
  // because PM's selection runs on the native event before React dispatches.
  const stopNativeMousedown = useCallback((el: HTMLDivElement | null) => {
    if (el) el.onmousedown = (e) => e.stopPropagation();
  }, []);

  // Seed the draft + focus whenever we (re-)enter edit mode.
  useEffect(() => {
    if (!editing) return;
    setText(valueRef.current ?? "");
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [editing]);

  const commit = useCallback(() => {
    onEditingChange(false);
    const next = text.trim();
    if (next !== (value ?? "")) onCommit(next);
  }, [text, value, onCommit, onEditingChange]);

  if (editing) {
    return (
      <div
        className="block-caption block-caption-editing"
        contentEditable={false}
        onClick={(e) => e.stopPropagation()}
        ref={stopNativeMousedown}
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
              onEditingChange(false);
            }
          }}
          placeholder={placeholder}
          ref={inputRef}
          value={text}
        />
      </div>
    );
  }

  if (!value) return null;

  return (
    <div
      className="block-caption"
      contentEditable={false}
      onClick={(e) => {
        e.stopPropagation();
        onEditingChange(true);
      }}
      ref={stopNativeMousedown}
    >
      {value}
    </div>
  );
}
