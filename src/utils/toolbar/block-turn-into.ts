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
    // setNode (core command) instead of setParagraph: Baram's Paragraph
    // extension doesn't declare a setParagraph command on ChainedCommands.
    run: (e) => e.chain().focus().setNode("paragraph").run(),
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
    label: "Heading 4",
    isActive: (t, a) => t === "heading" && a.level === 4,
    run: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(),
  },
  {
    label: "Heading 5",
    isActive: (t, a) => t === "heading" && a.level === 5,
    run: (e) => e.chain().focus().toggleHeading({ level: 5 }).run(),
  },
  {
    label: "Heading 6",
    isActive: (t, a) => t === "heading" && a.level === 6,
    run: (e) => e.chain().focus().toggleHeading({ level: 6 }).run(),
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
    // §5.1 Toggle (collapsible). wrapIn keeps the block's content as the
    // toggle's summary (first child); setToggle would instead insert a new
    // empty toggle, losing the current text. No-op handled by the builder's
    // isActive guard, so "Toggle" on an existing toggle does nothing.
    label: "Toggle",
    isActive: (t) => t === "toggle",
    run: (e) => e.chain().focus().wrapIn("toggle").run(),
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
      if (spec.isActive(typeName, attrs)) return; // already this type — no-op
      // Select inside the target block before converting.
      editor.commands.setTextSelection(pos + 1);
      spec.run(editor);
    },
  }));
}
