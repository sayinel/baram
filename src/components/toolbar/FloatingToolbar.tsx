// §4.7 Floating Toolbar — BubbleMenu on text selection
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { BubbleMenu } from "@tiptap/react/menus";
import { Sparkles } from "lucide-react";

import {
  executeAICommand,
  getSelectedText,
  showPrompt,
} from "../../utils/ai-commands";
import {
  type ContentMode,
  detectContentType,
} from "../../utils/content-type-detector";
import {
  type AIAction,
  getActionsForMode,
} from "../../utils/contextual-ai-actions";
import { showFieldDialog } from "../../utils/field-dialog";

interface FloatingToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  isActive: boolean;
  label: string;
  onClick: () => void;
  title: string;
}

function ToolbarButton({
  label,
  title,
  isActive,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      className={`floating-toolbar-btn ${isActive ? "floating-toolbar-btn-active" : ""}`}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
    >
      {label}
    </button>
  );
}

// §6.2 / §11.2.3 Selection-based contextual AI commands in FloatingToolbar dropdown
const AFTER_SEL = { afterSelection: true } as const;

export function FloatingToolbar({ editor }: FloatingToolbarProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [dropReady, setDropReady] = useState(false);
  const [contentMode, setContentMode] = useState<ContentMode>("text");
  const aiRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!aiOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (aiRef.current && !aiRef.current.contains(e.target as Node)) {
        setAiOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [aiOpen]);

  // Measure dropdown after render, decide direction, then reveal
  useEffect(() => {
    if (!aiOpen) {
      setDropUp(false);
      setDropReady(false);
      return;
    }
    // Wait one frame so DOM layout (including tippy) is settled
    const raf = requestAnimationFrame(() => {
      if (!dropdownRef.current || !aiRef.current) return;
      const btnRect = aiRef.current.getBoundingClientRect();
      const ddRect = dropdownRef.current.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const spaceBelow = window.innerHeight - btnRect.bottom - gap - margin;
      setDropUp(ddRect.height > spaceBelow);
      setDropReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [aiOpen]);

  const handleAIOpen = useCallback(() => {
    const { from, to } = editor.state.selection;
    const nodeTypes: { type: string }[] = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock) {
        nodeTypes.push({ type: node.type.name });
      }
    });
    setContentMode(detectContentType(nodeTypes));
    setAiOpen((v) => !v);
  }, [editor]);

  const handleContextualAction = useCallback(
    (action: AIAction) => {
      const selection = getSelectedText(editor);
      if (!selection) {
        setAiOpen(false);
        return;
      }
      setAiOpen(false);
      if (action.id === "translate") {
        showPrompt("Target language:", "", {
          presets: ["English", "Korean"],
        }).then((lang) => {
          if (lang) {
            executeAICommand(
              editor,
              selection,
              action.systemPrompt.replace("{language}", lang),
              AFTER_SEL,
            );
          }
        });
      } else if (action.id === "tone") {
        showPrompt("Select tone:", "", {
          presets: ["Formal", "Casual", "Professional", "Friendly"],
        }).then((tone) => {
          if (tone) {
            executeAICommand(
              editor,
              selection,
              action.systemPrompt.replace("{tone}", tone),
              AFTER_SEL,
            );
          }
        });
      } else if (action.id === "convert-lang") {
        showPrompt("Target language:", "", {
          presets: ["Python", "JavaScript", "TypeScript", "Rust"],
        }).then((lang) => {
          if (lang) {
            executeAICommand(
              editor,
              selection,
              action.systemPrompt.replace("{language}", lang),
              AFTER_SEL,
            );
          }
        });
      } else {
        executeAICommand(editor, selection, action.systemPrompt, AFTER_SEL);
      }
    },
    [editor],
  );

  const shouldShow = useCallback(() => {
    const { selection } = editor.state;
    // Hide for CellSelection — TableToolbar handles table multi-cell selection
    if (selection instanceof CellSelection) return false;
    // Hide for NodeSelection — atom NodeViews (math, mermaid, image) have their own UI
    if (selection instanceof NodeSelection) return false;
    // Default BubbleMenu behavior for text selections
    const { from, to } = selection;
    return from !== to;
  }, [editor]);

  return (
    <BubbleMenu
      className="floating-toolbar"
      editor={editor}
      shouldShow={shouldShow}
    >
      <ToolbarButton
        isActive={editor.isActive("bold")}
        label="B"
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Cmd+B)"
      />
      <ToolbarButton
        isActive={editor.isActive("italic")}
        label="I"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Cmd+I)"
      />
      <ToolbarButton
        isActive={editor.isActive("strike")}
        label="S"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough (Cmd+Shift+X)"
      />
      <ToolbarButton
        isActive={editor.isActive("highlight")}
        label="H"
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        title="Highlight (Cmd+Shift+H)"
      />
      <ToolbarButton
        isActive={editor.isActive("superscript")}
        label="X²"
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        title="Superscript"
      />
      <ToolbarButton
        isActive={editor.isActive("subscript")}
        label="X₂"
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        title="Subscript"
      />
      <ToolbarButton
        isActive={editor.isActive("code")}
        label="<>"
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline Code (Cmd+E)"
      />
      <ToolbarButton
        isActive={editor.isActive("link")}
        label="Lk"
        onClick={async () => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const result = await showFieldDialog({
            title: "Insert Link",
            fields: [{ key: "url", label: "URL", placeholder: "https://..." }],
          });
          if (!result?.url) {
            editor.commands.focus();
            return;
          }
          editor.chain().focus().setLink({ href: result.url }).run();
        }}
        title="Link"
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        isActive={editor.isActive("heading", { level: 1 })}
        label="H1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      />
      <ToolbarButton
        isActive={editor.isActive("heading", { level: 2 })}
        label="H2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        isActive={editor.isActive("blockquote")}
        label="Q"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
      />
      <ToolbarButton
        isActive={editor.isActive("bulletList")}
        label="UL"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Unordered List"
      />
      <ToolbarButton
        isActive={editor.isActive("orderedList")}
        label="OL"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Ordered List"
      />
      <div className="floating-toolbar-separator" />
      <div className="floating-toolbar-ai-wrapper" ref={aiRef}>
        <button
          className={`floating-toolbar-btn ${aiOpen ? "floating-toolbar-btn-active" : ""}`}
          onClick={handleAIOpen}
          title="AI Commands"
        >
          <Sparkles size={14} />
        </button>
        {aiOpen && (
          <div
            className={`floating-toolbar-ai-dropdown ${dropUp ? "floating-toolbar-ai-dropdown-up" : ""}`}
            ref={dropdownRef}
            style={dropReady ? undefined : { visibility: "hidden" }}
          >
            {getActionsForMode(contentMode).map((action) => (
              <button
                className="floating-toolbar-ai-item"
                key={action.id}
                onClick={() => handleContextualAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
