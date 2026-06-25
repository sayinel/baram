// §4.8 "Turn into" block-type conversion builder for the block handle menu.
import type { Editor } from "@tiptap/core";

export interface TurnIntoItem {
  isActive: boolean;
  label: string;
  run: () => void;
}

interface Spec {
  isActive: (typeName: string, attrs: Record<string, unknown>) => boolean;
  label: string;
  run: (editor: Editor) => void;
}

const SPECS: Spec[] = [
  {
    label: "Text",
    isActive: (t) => t === "paragraph",
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    label: "Heading 1",
    isActive: (t, a) => t === "heading" && a.level === 1,
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    isActive: (t, a) => t === "heading" && a.level === 2,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    isActive: (t, a) => t === "heading" && a.level === 3,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Bullet List",
    isActive: (t) => t === "bulletList",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered List",
    isActive: (t) => t === "orderedList",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "To-do List",
    isActive: (t) => t === "taskList",
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: "Quote",
    isActive: (t) => t === "blockquote",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Code",
    isActive: (t) => t === "codeBlock",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

/** §4.8 Build "Turn into" items for the block at `pos`. */
export function buildTurnIntoItems(
  editor: Editor,
  pos: number,
): TurnIntoItem[] {
  const node = editor.state.doc.nodeAt(pos);
  const typeName = node?.type.name ?? "";
  const attrs = (node?.attrs ?? {}) as Record<string, unknown>;
  return SPECS.map((spec) => ({
    label: spec.label,
    isActive: spec.isActive(typeName, attrs),
    run: () => {
      // Select inside the target block before converting.
      editor.commands.setTextSelection(pos + 1);
      spec.run(editor);
    },
  }));
}
