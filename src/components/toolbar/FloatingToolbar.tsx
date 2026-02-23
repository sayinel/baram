// §4.7 Floating Toolbar — BubbleMenu on text selection
import { useState, useRef, useEffect, useCallback } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { executeAICommand, getSelectedText, showPrompt } from "../../utils/ai-commands";

interface FloatingToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  isActive: boolean;
  onClick: () => void;
}

function ToolbarButton({ label, title, isActive, onClick }: ToolbarButtonProps) {
  return (
    <button
      className={`floating-toolbar-btn ${isActive ? "floating-toolbar-btn-active" : ""}`}
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
        `Translate to ${lang}:\n\n${selection}`,
        "You are a translation assistant. Translate the text to the specified language. Output only the translated text, no explanations.",
        AFTER_SEL,
      );
    },
  },
  {
    id: "ai-summarize",
    label: "Summarize",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(
        editor,
        selection,
        "You are a summarization assistant. Summarize the given text concisely in markdown. Output only the summary.",
        AFTER_SEL,
      );
    },
  },
  {
    id: "ai-expand",
    label: "Expand",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(
        editor,
        selection,
        "You are a writing assistant. Expand the given text with more details, examples, and explanations. Output in markdown.",
        AFTER_SEL,
      );
    },
  },
  {
    id: "ai-fix-grammar",
    label: "Fix Grammar",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(
        editor,
        selection,
        "You are a grammar checker. Fix grammar and spelling errors in the given text. Return only the corrected text, no explanations.",
        AFTER_SEL,
      );
    },
  },
  {
    id: "ai-explain",
    label: "Explain",
    needsSelection: true,
    execute: (editor: Editor, selection: string) => {
      executeAICommand(
        editor,
        selection,
        "You are an explanation assistant. Explain the given text clearly and concisely in markdown.",
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

  return (
    <BubbleMenu
      editor={editor}
      className="floating-toolbar"
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
