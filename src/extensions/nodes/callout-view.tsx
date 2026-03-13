import { useCallback, useEffect, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";

// §5.9 Callout NodeView — React component for rendering callout blocks
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import {
  AlertTriangle,
  Bug,
  CheckSquare,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  Info,
  Lightbulb,
  List,
  OctagonAlert,
  Pencil,
  Quote,
} from "lucide-react";

/** Callout type definition with Lucide icon and display label */
interface CalloutTypeDef {
  color: string;
  icon: LucideIcon;
  label: string;
}

const CALLOUT_TYPES: Record<string, CalloutTypeDef> = {
  tip: { color: "#10b981", icon: Lightbulb, label: "Tip" },
  info: { color: "#3b82f6", icon: Info, label: "Info" },
  warning: { color: "#f59e0b", icon: AlertTriangle, label: "Warning" },
  danger: { color: "#ef4444", icon: OctagonAlert, label: "Danger" },
  note: { color: "#6b7280", icon: Pencil, label: "Note" },
  abstract: { color: "#8b5cf6", icon: ClipboardList, label: "Abstract" },
  todo: { color: "#06b6d4", icon: CheckSquare, label: "Todo" },
  example: { color: "#14b8a6", icon: List, label: "Example" },
  quote: { color: "#9ca3af", icon: Quote, label: "Quote" },
  bug: { color: "#ef4444", icon: Bug, label: "Bug" },
  success: { color: "#22c55e", icon: CircleCheck, label: "Success" },
  failure: { color: "#ef4444", icon: CircleX, label: "Failure" },
  question: { color: "#eab308", icon: CircleHelp, label: "Question" },
};

const CALLOUT_TYPE_KEYS = Object.keys(CALLOUT_TYPES);

export function CalloutView({ editor, node, updateAttributes }: NodeViewProps) {
  const type = (node.attrs.type as string) || "info";
  const title = (node.attrs.title as string) || "";
  const collapsed = node.attrs.collapsed as boolean;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  const handleIconClick = useCallback(() => {
    if (!editor.isEditable) return;
    setIsPickerOpen((prev) => !prev);
  }, [editor.isEditable]);

  const handleTypeSelect = useCallback(
    (newType: string) => {
      updateAttributes({ type: newType });
      setIsPickerOpen(false);
    },
    [updateAttributes],
  );

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Close picker on outside click
  useEffect(() => {
    if (!isPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isPickerOpen]);

  // Close picker on Escape
  useEffect(() => {
    if (!isPickerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPickerOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isPickerOpen]);

  return (
    <NodeViewWrapper
      className={`callout callout-${type}`}
      data-callout-type={type}
      data-type="callout"
    >
      <div className="callout-header" contentEditable={false}>
        <div className="callout-icon-wrapper" ref={pickerRef}>
          <button
            className="callout-icon-btn"
            onClick={handleIconClick}
            title="Change callout type"
            type="button"
          >
            <CalloutIcon type={type} />
          </button>

          {isPickerOpen && (
            <div className="callout-type-picker">
              {CALLOUT_TYPE_KEYS.map((key) => {
                const def = CALLOUT_TYPES[key];
                return (
                  <button
                    className={`callout-type-option${key === type ? "active" : ""}`}
                    key={key}
                    onClick={() => handleTypeSelect(key)}
                    title={def.label}
                    type="button"
                  >
                    <CalloutIcon size={16} type={key} />
                    <span className="callout-type-label">{def.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isEditingTitle ? (
          <input
            className="callout-title-input"
            defaultValue={title}
            onBlur={(e) => commitTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle(e.currentTarget.value);
              if (e.key === "Escape") setIsEditingTitle(false);
            }}
            ref={titleInputRef}
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
          type="button"
        >
          {collapsed ? "▶" : "▼"}
        </button>
      </div>

      <NodeViewContent
        className={`callout-body${collapsed ? "callout-body-collapsed" : ""}`}
      />
    </NodeViewWrapper>
  );
}

function CalloutIcon({ size = 18, type }: { size?: number; type: string }) {
  const def = CALLOUT_TYPES[type] || CALLOUT_TYPES.info;
  const Icon = def.icon;
  return <Icon size={size} strokeWidth={2} style={{ color: def.color }} />;
}
