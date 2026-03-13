// convert-list.ts — List node conversion (bulletList, orderedList, taskList)
// Extracted from md-to-pm.ts for single-responsibility

import type { ConvertBlockFn } from "./convert-block-special";
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Content } from "mdast";

/** Convert list item children (ensure listItem wrapping) */
export function convertListItemChildren(
  children: Content[],
  schema: Schema,
  convertBlockChildren: ConvertBlockFn,
): PmNode[] {
  const result: PmNode[] = [];

  for (const child of children) {
    if (child.type === "listItem") {
      const item = child as { checked?: boolean | null; children: Content[] };

      if (item.checked != null) {
        // Task item
        let innerChildren = convertBlockChildren(item.children, schema);
        // Empty task items must have at least one paragraph for cursor placement
        if (innerChildren.length === 0) {
          innerChildren = [schema.nodes.paragraph.create()];
        }
        result.push(
          schema.nodes.taskItem.create(
            { checked: item.checked ?? false },
            innerChildren,
          ),
        );
      } else {
        // Regular list item
        let innerChildren = convertBlockChildren(item.children, schema);
        // Empty list items must have at least one paragraph for cursor placement
        if (innerChildren.length === 0) {
          innerChildren = [schema.nodes.paragraph.create()];
        }
        result.push(schema.nodes.listItem.create(null, innerChildren));
      }
    }
  }

  return result;
}

/** Convert an mdast list node to PM list node (bulletList/orderedList/taskList) */
export function convertListNode(
  node: Content,
  schema: Schema,
  convertBlockChildren: ConvertBlockFn,
): PmNode {
  const list = node as {
    children: Content[];
    ordered?: boolean;
    start?: number;
  };

  // Check if any child has a checked property → task list
  const hasTaskItems = list.children.some(
    (child) =>
      child.type === "listItem" &&
      (child as { checked?: boolean | null }).checked != null,
  );

  if (hasTaskItems) {
    const items = list.children.map((child) => {
      const item = child as { checked?: boolean | null; children: Content[] };
      const innerChildren = convertBlockChildren(item.children, schema);
      return schema.nodes.taskItem.create(
        { checked: item.checked ?? false },
        innerChildren,
      );
    });
    return schema.nodes.taskList.create(null, items);
  }

  // Ordered or bullet list
  const items = convertListItemChildren(
    list.children,
    schema,
    convertBlockChildren,
  );

  if (list.ordered) {
    return schema.nodes.orderedList.create({ start: list.start ?? 1 }, items);
  }

  return schema.nodes.bulletList.create(null, items);
}
