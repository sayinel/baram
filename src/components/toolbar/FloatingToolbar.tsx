// §4.7 Floating Toolbar — BubbleMenu on text selection
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";

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

export function FloatingToolbar({ editor }: FloatingToolbarProps) {
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
    </BubbleMenu>
  );
}
