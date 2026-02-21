// §5.9 Callout NodeView — React component for rendering callout blocks
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useCallback, useState, useRef, useEffect } from "react";

/** Callout type → emoji icon mapping */
const CALLOUT_ICONS: Record<string, string> = {
  tip: "💡",
  info: "ℹ️",
  warning: "⚠️",
  danger: "🔴",
  note: "📝",
  abstract: "📋",
  todo: "☑️",
  example: "📄",
  quote: "❝",
  bug: "🐛",
  success: "✅",
  failure: "❌",
  question: "❓",
};

function getIcon(type: string): string {
  return CALLOUT_ICONS[type] || CALLOUT_ICONS.info;
}

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const type = (node.attrs.type as string) || "info";
  const title = (node.attrs.title as string) || "";
  const collapsed = node.attrs.collapsed as boolean;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const toggleCollapsed = useCallback(() => {
    updateAttributes({ collapsed: !collapsed });
  }, [collapsed, updateAttributes]);

  const handleTitleDoubleClick = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditingTitle(true);
  }, [editor.isEditable]);

  const commitTitle = useCallback(
    (value: string) => {
      updateAttributes({ title: value });
      setIsEditingTitle(false);
    },
    [updateAttributes],
  );

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  return (
    <NodeViewWrapper
      data-type="callout"
      data-callout-type={type}
      className={`callout callout-${type}`}
    >
      <div
        className="callout-header"
        contentEditable={false}
      >
        <span className="callout-icon">{getIcon(type)}</span>

        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="callout-title-input"
            defaultValue={title}
            onBlur={(e) => commitTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle(e.currentTarget.value);
              if (e.key === "Escape") setIsEditingTitle(false);
            }}
          />
        ) : (
          <span
            className="callout-title"
            onDoubleClick={handleTitleDoubleClick}
          >
            {title || type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
        )}

        <button
          className="callout-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▶" : "▼"}
        </button>
      </div>

      <NodeViewContent
        className={`callout-body${collapsed ? " callout-body-collapsed" : ""}`}
      />
    </NodeViewWrapper>
  );
}
