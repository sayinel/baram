// §5.1 Task Item Extension
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("taskItemClick"),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target;
              if (
                !(target instanceof HTMLInputElement) ||
                target.type !== "checkbox"
              )
                return false;
              const li = target.closest('li[data-type="taskItem"]');
              if (!li) return false;

              event.preventDefault();

              const pos = view.posAtDOM(li, 0);
              const $pos = view.state.doc.resolve(pos);
              for (let d = $pos.depth; d > 0; d--) {
                const node = $pos.node(d);
                if (node.type.name === "taskItem") {
                  view.dispatch(
                    view.state.tr.setNodeMarkup($pos.before(d), undefined, {
                      ...node.attrs,
                      checked: !node.attrs.checked,
                    }),
                  );
                  return true;
                }
              }
              return false;
            },
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});
