// §4.7 Floating Toolbar — BubbleMenu on text selection
import { useState, useRef, useEffect, useCallback } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { CellSelection } from "@tiptap/pm/tables";
import {
  executeAICommand,
  getSelectedText,
  showPrompt,
} from "../../utils/ai-commands";
import { showFieldDialog } from "../../utils/field-dialog";
import {
  AI_TRANSLATE,
  AI_SUMMARIZE,
  AI_EXPAND,
  AI_FIX_GRAMMAR,
  AI_EXPLAIN,
  AI_IMPROVE,
  AI_SHORTEN,
  AI_TONE_CHANGE,
} from "../../utils/ai-command-prompts";

interface FloatingToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  isActive: boolean;
  onClick: () => void;
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
}

// §6.2 Selection-based AI commands in FloatingToolbar dropdown
const AFTER_SEL = { afterSelection: true } as const;

const AI_COMMANDS = [
  {
    id: "ai-translate",
    label: "Translate",
    needsSelection: true,
    execute: async (editor: Editor, selection: string) => {
      const lang = await showPrompt("Target language:", "", {
        presets: ["English", "Korean"],
      });
      if (!lang) return;
      executeAICommand(
        editor,
        selection,
        AI_TRANSLATE.replace("{language}", lang),
        AFTER_SEL,
      );
    },
  },
  {
    id: "ai-summarize",
    label: "Summarize",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(editor, selection, AI_SUMMARIZE, AFTER_SEL);
    },
  },
  {
    id: "ai-expand",
    label: "Expand",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(editor, selection, AI_EXPAND, AFTER_SEL);
    },
  },
  {
    id: "ai-fix-grammar",
    label: "Fix Grammar",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(editor, selection, AI_FIX_GRAMMAR, AFTER_SEL);
    },
  },
  {
    id: "ai-explain",
    label: "Explain",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(editor, selection, AI_EXPLAIN, AFTER_SEL);
    },
  },
  {
    id: "ai-improve",
    label: "Improve",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(editor, selection, AI_IMPROVE, AFTER_SEL);
    },
  },
  {
    id: "ai-shorten",
    label: "Shorten",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(editor, selection, AI_SHORTEN, AFTER_SEL);
    },
  },
  {
    id: "ai-tone-change",
    label: "Tone Change",
    needsSelection: true,
    execute: async (editor: Editor, selection: string) => {
      const tone = await showPrompt("Select tone:", "", {
        presets: ["Formal", "Casual", "Professional", "Friendly"],
      });
      if (!tone) return;
      executeAICommand(
        editor,
        selection,
        AI_TONE_CHANGE.replace("{tone}", tone),
        AFTER_SEL,
      );
    },
  },
];

export function FloatingToolbar({ editor }: FloatingToolbarProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [dropReady, setDropReady] = useState(false);
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

  const handleAICommand = useCallback(
    (cmd: (typeof AI_COMMANDS)[number]) => {
      const selection = getSelectedText(editor);
      if (cmd.needsSelection && !selection) {
        window.alert("Please select text first.");
        setAiOpen(false);
        return;
      }
      setAiOpen(false);
      cmd.execute(editor, selection);
    },
    [editor],
  );

  const shouldShow = useCallback(() => {
    // Hide for CellSelection — TableToolbar handles table multi-cell selection
    if (editor.state.selection instanceof CellSelection) return false;
    // Default BubbleMenu behavior for text selections
    const { from, to } = editor.state.selection;
    return from !== to;
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      className="floating-toolbar"
      shouldShow={shouldShow}
    >
      <ToolbarButton
        label="B"
        title="Bold (Cmd+B)"
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="I"
        title="Italic (Cmd+I)"
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="S"
        title="Strikethrough (Cmd+Shift+X)"
        isActive={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        label="H"
        title="Highlight (Cmd+Shift+H)"
        isActive={editor.isActive("highlight")}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      />
      <ToolbarButton
        label="X²"
        title="Superscript"
        isActive={editor.isActive("superscript")}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      />
      <ToolbarButton
        label="X₂"
        title="Subscript"
        isActive={editor.isActive("subscript")}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      />
      <ToolbarButton
        label="<>"
        title="Inline Code (Cmd+E)"
        isActive={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <ToolbarButton
        label="Lk"
        title="Link"
        isActive={editor.isActive("link")}
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
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        label="H1"
        title="Heading 1"
        isActive={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        label="H2"
        title="Heading 2"
        isActive={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        label="Q"
        title="Blockquote"
        isActive={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        label="UL"
        title="Bullet List"
        isActive={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="OL"
        title="Ordered List"
        isActive={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <div className="floating-toolbar-separator" />
      <div className="floating-toolbar-ai-wrapper" ref={aiRef}>
        <button
          className={`floating-toolbar-btn ${aiOpen ? "floating-toolbar-btn-active" : ""}`}
          onClick={() => setAiOpen((v) => !v)}
          title="AI Commands"
        >
          AI
        </button>
        {aiOpen && (
          <div
            ref={dropdownRef}
            className={`floating-toolbar-ai-dropdown ${dropUp ? "floating-toolbar-ai-dropdown-up" : ""}`}
            style={dropReady ? undefined : { visibility: "hidden" }}
          >
            {AI_COMMANDS.map((cmd) => (
              <button
                key={cmd.id}
                className="floating-toolbar-ai-item"
                onClick={() => handleAICommand(cmd)}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
