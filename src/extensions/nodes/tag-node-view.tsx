// §56m Tag NodeView — renders #tag as styled inline pill
// Single-click → search by tag, Double-click → inline edit
import { useCallback, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";

export function TagNodeView({
  node,
  selected,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const tag = (node.attrs.tag as string) || "";
  const tagColor = useSettingsStore((s) => s.tagColors)[tag];
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tag);
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSearch = useCallback(() => {
    const store = useUIStore.getState();
    const needsOpen = !store.sidebarOpen || store.sidebarPanel !== "search";
    if (!store.sidebarOpen) {
      store.toggleSidebar();
    }
    if (store.sidebarPanel !== "search") {
      store.setSidebarPanel("search");
    }
    const dispatchSearch = () =>
      window.dispatchEvent(
        new CustomEvent("baram:search-query", { detail: { query: `#${tag}` } }),
      );
    if (needsOpen) {
      requestAnimationFrame(() => requestAnimationFrame(dispatchSearch));
    } else {
      dispatchSearch();
    }
  }, [tag]);

  const startEditing = useCallback(() => {
    setEditValue(tag);
    setIsEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [tag]);

  const commitEdit = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim().replace(/^#/, "");
    if (trimmed && trimmed !== tag) {
      updateAttributes({ tag: trimmed });
    }
    editor?.commands.focus();
  }, [editValue, tag, updateAttributes, editor]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditValue(tag);
    editor?.commands.focus();
  }, [tag, editor]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return; // let input handle its own events

      e.preventDefault();
      e.stopPropagation(); // prevent ProseMirror NodeSelection (floating toolbar)

      // Double-click detection: if timer is pending, this is the second click
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        startEditing();
        return;
      }

      // Start single-click timer — triggers search after delay
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        triggerSearch();
      }, 250);
    },
    [isEditing, triggerSearch, startEditing],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation(); // prevent ProseMirror shortcuts
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit],
  );

  if (isEditing) {
    return (
      <NodeViewWrapper
        as="span"
        className="tag-node tag-node-editing"
        data-tag={tag}
      >
        <span className="tag-node-hash">#</span>
        <input
          ref={inputRef}
          className="tag-node-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={commitEdit}
          spellCheck={false}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`tag-node ${selected ? "tag-node-selected" : ""}`}
      data-tag={tag}
      onMouseDown={handleMouseDown}
      title={`#${tag} — 더블 클릭으로 편집`}
      style={{ color: tagColor || undefined }}
    >
      <span className="tag-node-hash">#</span>
      {tag}
    </NodeViewWrapper>
  );
}
