// §5.1 Task Item Extension
import { Node, mergeAttributes } from "@tiptap/core";

export interface TaskItemOptions {
  HTMLAttributes: Record<string, string>;
  nested: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    taskItem: {
      toggleChecked: () => ReturnType;
    };
  }
}

export const TaskItem = Node.create<TaskItemOptions>({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      nested: true,
    };
  },

  addAttributes() {
    return {
      checked: { default: false, keepOnSplit: false },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "taskItem",
        "data-checked": node.attrs.checked ? "true" : "false",
      }),
      [
        "label",
        { contenteditable: "false" },
        [
          "input",
          { type: "checkbox", checked: node.attrs.checked ? "checked" : null },
        ],
      ],
      ["div", 0],
    ];
  },

  addCommands() {
    return {
      toggleChecked:
        () =>
        ({ tr, state }) => {
          const { $from } = state.selection;
          const node = $from.node($from.depth);
          if (node.type.name === this.name) {
            tr.setNodeMarkup($from.before($from.depth), undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            });
            return true;
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});
