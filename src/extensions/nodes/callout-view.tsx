import { useCallback, useEffect, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";

// §5.9 Callout NodeView — React component for rendering callout blocks
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { Sparkles } from "lucide-react";

import { Tooltip } from "../../components/Tooltip";
import { useEditorChrome } from "../../hooks/use-editor-chrome";
import { useTranslation } from "../../i18n/useTranslation";
import { useFeatureFlags } from "../../stores/settings/features";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import {
  canUseEditorChrome,
  updateNodeAttributesWithVim,
} from "../plugins/vim/vim-keys";
import {
  CALLOUT_TYPE_KEYS,
  CALLOUT_TYPES,
  calloutTypeLabel,
} from "./callout-types";

export function CalloutView({
  editor,
  getPos,
  node,
  updateAttributes,
}: NodeViewProps) {
  const { t } = useTranslation();
  const { ai: aiEnabled } = useFeatureFlags();
  const type = (node.attrs.type as string) || "info";
  const title = (node.attrs.title as string) || "";
  const collapsed = node.attrs.collapsed as boolean;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const toggleCollapsed = useCallback(() => {
    // §12-⑩ event-time guard (issue 375): `collapsed` is a PERSISTED attr
    // (`> [!note]-`), so a click on a read-only editor would dirty the file.
    // Same shape as commitTitle/handleTypeSelect. This button is always
    // mounted (no render gate), so the event-time check is the only thing
    // between a click and the document.
    if (!canUseEditorChrome(editor)) return;
    // §12-6: chrome control — tagged (design §5b)
    updateNodeAttributesWithVim(editor, getPos, { collapsed: !collapsed });
  }, [collapsed, editor, getPos]);

  // §12-⑩: NOT editor.isEditable — that locks chrome and the title island
  // during vim normal (view.editable=false). Reactive: a bare render read
  // would go stale, since ReactNodeView skips re-render on unchanged nodes.
  const canEdit = useEditorChrome(editor);

  const handleTitleDoubleClick = useCallback(() => {
    if (!canEdit) return;
    setIsEditingTitle(true);
  }, [canEdit]);

  const commitTitle = useCallback(
    (value: string) => {
      // §12-⑩ event-time guard: the input may be stale-rendered — capability
      // can have been revoked after it mounted.
      if (canUseEditorChrome(editor)) updateAttributes({ title: value });
      setIsEditingTitle(false);
    },
    [editor, updateAttributes],
  );

  const handleIconClick = useCallback(() => {
    if (!canEdit) return;
    setIsPickerOpen((prev) => !prev);
  }, [canEdit]);

  const handleTypeSelect = useCallback(
    (newType: string) => {
      // §12-⑩ event-time guard — see commitTitle.
      if (canUseEditorChrome(editor)) {
        updateNodeAttributesWithVim(editor, getPos, { type: newType });
      }
      setIsPickerOpen(false);
    },
    [editor, getPos],
  );

  // §12-⑩: a capability revocation must CLOSE already-open chrome — the
  // event-time guard keeps the doc safe, but an open picker/title input
  // would otherwise stay visible and silently discard the user's typing
  // (impl review R1).
  useEffect(() => {
    if (!canEdit) {
      setIsPickerOpen(false);
      setIsEditingTitle(false);
    }
  }, [canEdit]);

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
      {/* §298 §12-3: header marker covers the type picker AND title input (§4) */}
      <div
        className="callout-header"
        contentEditable={false}
        data-vim-suspend=""
      >
        <div className="callout-icon-wrapper" ref={pickerRef}>
          <Tooltip label={t("callout.changeType")} placement="bottom">
            <button
              className="callout-icon-btn"
              onClick={handleIconClick}
              type="button"
            >
              <CalloutIcon type={type} />
            </button>
          </Tooltip>

          {canEdit && isPickerOpen && (
            <div className="callout-type-picker">
              {CALLOUT_TYPE_KEYS.map((key) => {
                const def = CALLOUT_TYPES[key];
                return (
                  <button
                    className={["callout-type-option", key === type && "active"]
                      .filter(Boolean)
                      .join(" ")}
                    key={key}
                    onClick={() => handleTypeSelect(key)}
                    type="button"
                  >
                    <CalloutIcon size={16} type={key} />
                    <span className="callout-type-label">{t(def.label)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {canEdit && isEditingTitle ? (
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
            {title || calloutTypeLabel(t, type)}
          </span>
        )}

        {aiEnabled && (
          <Tooltip label={t("toolbar.ai.commands")} placement="bottom">
            <button
              className="callout-ai-btn"
              onClick={(e) => {
                e.stopPropagation();
                const text = node.textContent || "";
                if (!text.trim()) return;
                const pos = getPos();
                if (typeof pos !== "number") return;
                showNodeViewAIMenu(e.currentTarget, "text", text, editor, pos);
              }}
              ref={(el) => {
                if (el) el.onmousedown = (e) => e.stopPropagation();
              }}
              type="button"
            >
              <Sparkles size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip
          label={
            collapsed ? t("blockChrome.expand") : t("blockChrome.collapse")
          }
          placement="bottom"
        >
          <button
            className="callout-collapse-btn"
            onClick={toggleCollapsed}
            type="button"
          >
            {collapsed ? "▶" : "▼"}
          </button>
        </Tooltip>
      </div>

      <NodeViewContent
        className={
          collapsed ? "callout-body callout-body-collapsed" : "callout-body"
        }
      />
    </NodeViewWrapper>
  );
}

function CalloutIcon({ size = 18, type }: { size?: number; type: string }) {
  const def = CALLOUT_TYPES[type] || CALLOUT_TYPES.info;
  const Icon = def.icon;
  return <Icon size={size} strokeWidth={2} style={{ color: def.color }} />;
}
