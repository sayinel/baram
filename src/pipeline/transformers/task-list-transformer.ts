// task-list-transformer.ts — §5.1 Task List mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, List, ListItem } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const taskListTransformer: NodeTransformerEntry = {
  mdastType: "list",
  pmType: "taskList",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const list = node as List;
    // Task list: unordered list where children have checked property
    const children = list.children as ListItem[];
    const isTaskList = children.some((child) => child.checked != null);
    if (!isTaskList) return null;

    const pmChildren = children.map((child) => {
      const itemChildren = convertChildren(child);
      return schema.nodes.taskItem.create(
        { checked: child.checked ?? false },
        itemChildren,
      );
    });

    return schema.nodes.taskList.create(null, pmChildren);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    const children: ListItem[] = [];
    node.forEach((child) => {
      children.push({
        type: "listItem",
        checked: (child.attrs.checked as boolean) ?? false,
        spread: false,
        children: convertChildren(child),
      } as ListItem);
    });

    return {
      type: "list",
      ordered: false,
      spread: false,
      children,
    } as List;
  },
};
