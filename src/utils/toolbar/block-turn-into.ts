// §4.8 "Turn into" block-type conversion builder for the block handle menu.
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

import { Selection } from "@tiptap/pm/state";

export interface TurnIntoItem {
  isActive: boolean;
  label: string;
  run: () => void;
  /** Render a group divider above this item. */
  separator?: boolean;
}

interface Spec {
  isActive: (node: PmNode) => boolean;
  label: string;
  run: (editor: Editor, pos: number) => void;
  /** Start a new visual group (divider rendered above). */
  separator?: boolean;
}

// Container blocks must be normalized to a plain paragraph BEFORE the target
// conversion is applied — otherwise the target either nests inside the container
// (e.g. a list item gains a toggle/quote/callout) or leaves the container in
// place. Every conversion succeeds when it starts from a paragraph.
//
// UNWRAP_TYPES are lifted by replacing the node with its block content.
const UNWRAP_TYPES = new Set(["blockquote", "callout", "toggle"]);
// LIST_TYPES are lifted by converting the item to a paragraph (toggles the list
// off), which ProseMirror pulls out to the top level.
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/** Replace the block at `pos` with a math block, using its text as the formula. */
function runMath(editor: Editor, pos: number): void {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  const mathType = state.schema.nodes.mathBlock;
  if (!node || !mathType) return;
  const tr = state.tr.replaceWith(
    pos,
    pos + node.nodeSize,
    mathType.create({ formula: node.textContent }),
  );
  editor.view.dispatch(tr);
}

// Order mirrors Notion: text → headings → lists → toggles → other blocks, with a
// divider starting each group.
const SPECS: Spec[] = [
  {
    label: "Text",
    isActive: (n) => n.type.name === "paragraph",
    // setNode (core command) instead of setParagraph: Baram's Paragraph
    // extension doesn't declare a setParagraph command on ChainedCommands.
    run: (e) => e.chain().focus().setNode("paragraph").run(),
  },
  {
    label: "Heading 1",
    isActive: (n) => n.type.name === "heading" && n.attrs.level === 1,
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    isActive: (n) => n.type.name === "heading" && n.attrs.level === 2,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    isActive: (n) => n.type.name === "heading" && n.attrs.level === 3,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Heading 4",
    isActive: (n) => n.type.name === "heading" && n.attrs.level === 4,
    run: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(),
  },
  {
    label: "Heading 5",
    isActive: (n) => n.type.name === "heading" && n.attrs.level === 5,
    run: (e) => e.chain().focus().toggleHeading({ level: 5 }).run(),
  },
  {
    label: "Heading 6",
    isActive: (n) => n.type.name === "heading" && n.attrs.level === 6,
    run: (e) => e.chain().focus().toggleHeading({ level: 6 }).run(),
  },
  {
    label: "To-do List",
    separator: true,
    isActive: (n) => n.type.name === "taskList",
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: "Unordered List",
    isActive: (n) => n.type.name === "bulletList",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Ordered List",
    isActive: (n) => n.type.name === "orderedList",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    // §5.1 Toggle (collapsible). wrapIn keeps the block's content as the
    // toggle's summary (first child); setToggle would insert a new empty toggle,
    // losing the current text.
    label: "Toggle",
    separator: true,
    isActive: (n) => n.type.name === "toggle",
    run: (e) => e.chain().focus().wrapIn("toggle").run(),
  },
  {
    label: "Quote",
    separator: true,
    isActive: (n) => n.type.name === "blockquote",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    // §5.9 Callout. wrapIn keeps the block as the callout's body (like Toggle).
    label: "Callout",
    isActive: (n) => n.type.name === "callout",
    run: (e) => e.chain().focus().wrapIn("callout").run(),
  },
  {
    label: "Code",
    isActive: (n) => n.type.name === "codeBlock",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    // §5.3 Math block (atom). Converts the block's text into the formula.
    label: "Math",
    isActive: (n) => n.type.name === "mathBlock",
    run: (e, pos) => runMath(e, pos),
  },
];

/** §4.8 Build "Turn into" items for the block at `pos`. */
export function buildTurnIntoItems(
  editor: Editor,
  pos: number,
): TurnIntoItem[] {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return [];
  return SPECS.map((spec) => ({
    label: spec.label,
    separator: spec.separator,
    isActive: spec.isActive(node),
    run: () => {
      if (spec.isActive(node)) return; // already this type — no-op

      const sourceType = node.type.name;
      if (UNWRAP_TYPES.has(sourceType)) {
        // toggle/callout/blockquote: replace the wrapper with its block content,
        // then aim the conversion at the former first child.
        editor
          .chain()
          .command(({ dispatch, tr }) => {
            const n = tr.doc.nodeAt(pos);
            if (!n || !UNWRAP_TYPES.has(n.type.name)) return false;
            if (dispatch) tr.replaceWith(pos, pos + n.nodeSize, n.content);
            return true;
          })
          .setTextSelection(pos + 1)
          .run();
      } else if (LIST_TYPES.has(sourceType)) {
        // list: select the WHOLE list and lift every item out to a top-level
        // paragraph (setNode would only lift the first item, leaving the rest as
        // a list). liftListItem leaves the selection spanning all the lifted
        // paragraphs, so the target then applies to the entire former list.
        //
        // The range must be the list's TEXT content (first text → last text),
        // NOT the node boundaries: a `to` at the list's closing boundary maps
        // onto the FOLLOWING block once the list lifts, so the target would
        // convert that next block instead of the list.
        const itemType = sourceType === "taskList" ? "taskItem" : "listItem";
        const doc = editor.state.doc;
        const from =
          Selection.findFrom(doc.resolve(pos), 1, true)?.from ?? pos + 1;
        const to =
          Selection.findFrom(doc.resolve(pos + node.nodeSize), -1, true)
            ?.from ?? pos + node.nodeSize - 1;
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .liftListItem(itemType)
          .run();
      } else {
        // Plain block — select inside it before converting.
        editor.commands.setTextSelection(pos + 1);
      }
      spec.run(editor, pos);
    },
  }));
}
