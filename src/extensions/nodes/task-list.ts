// §5.1 Task List Extension
import { Node, mergeAttributes, wrappingInputRule } from "@tiptap/core";

export interface TaskListOptions {
  HTMLAttributes: Record<string, string>;
  itemTypeName: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    taskList: {
      toggleTaskList: () => ReturnType;
    };
  }
}

export const TaskList = Node.create<TaskListOptions>({
  name: "taskList",
  group: "block",
  content: "taskItem+",

  addOptions() {
    return {
      HTMLAttributes: {},
      itemTypeName: "taskItem",
    };
  },

  parseHTML() {
    return [{ tag: 'ul[data-type="taskList"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "ul",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "taskList",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleTaskList:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, this.options.itemTypeName),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),
    };
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*\[([x ])\]\s$/i,
        type: this.type,
      }),
    ];
  },
});
