// convert-list.ts — List node conversion (bulletList, orderedList, taskList)
// Extracted from md-to-pm.ts for single-responsibility

import type { TaskState } from "../ipc/types";
import type { ConvertBlockFn } from "./convert-block-special";
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Content } from "mdast";

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
  const hasTaskItems = list.children.some((child) => {
    if (child.type !== "listItem") return false;
    const item = child as { checked?: boolean | null; children: Content[] };
    // §18.18 M4: a list of only `- [/]` items has no GFM-checked child at all,
    // so classifying on `checked` alone would leave it a bullet list.
    return item.checked != null || peekExtendedState(item) !== null;
  });

  if (hasTaskItems) {
    const items = convertListItemChildren(
      list.children,
      schema,
      convertBlockChildren,
    );
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

/**
 * §18.18 M4 — the non-GFM task states, `[/]` (doing) and `[-]` (cancelled).
 *
 * ‼️ Deliberately only these two characters. GFM makes a task item out of `[ ]`
 * and `[x]` alone, so everything else arrives here as an ordinary list item
 * whose text happens to start with a bracket — and people write that for their
 * own reasons: `- [1] citation`, `- [TODO] later`, `- [text](url)`. Matching
 * "any bracketed character" would turn those into tasks and rewrite the file on
 * the next save. The set stays closed, and grows only when a state is added.
 *
 * The trailing space is required, so `- []` and `- [x]y` are left alone.
 */
const EXTENDED_STATE_RE = /^\[([/-])\] /;

/** Marker character → the name the rest of the app uses (`ipc/types.ts`). */
const EXTENDED_STATE_BY_MARKER: Record<string, TaskState> = {
  "-": "cancelled",
  "/": "doing",
};

/**
 * Read (and remove) an extended state marker from a plain list item.
 *
 * Works on the mdast, before conversion: the marker is literal text at the head
 * of the first paragraph, and taking it off there means the PM node never
 * carries it and the serializer never has to find it again.
 */
function takeExtendedState(item: { children: Content[] }): null | TaskState {
  const first = leadingTextNode(item);
  if (!first) return null;

  const match = EXTENDED_STATE_RE.exec(first.value as string);
  if (!match) return null;

  const rest = (first.value as string).slice(match[0].length);
  if (rest === "") {
    // An item whose whole content WAS the marker — `- [/]` with the text
    // deleted. Leaving a zero-length text node here would reach
    // `schema.text("")`, which ProseMirror refuses; dropping it leaves the
    // empty paragraph every empty list item already has.
    (item.children[0] as { children: Content[] }).children.shift();
  } else {
    first.value = rest;
  }
  return EXTENDED_STATE_BY_MARKER[match[1]] ?? null;
}

/** The same read WITHOUT stripping — the list has to be classified before any
 *  item is consumed, and a detector that mutates would eat the marker it is
 *  only supposed to be looking at. */
function peekExtendedState(item: { children: Content[] }): null | TaskState {
  const first = leadingTextNode(item);
  if (!first) return null;
  const marker = EXTENDED_STATE_RE.exec(first.value as string)?.[1];
  return marker === undefined
    ? null
    : (EXTENDED_STATE_BY_MARKER[marker] ?? null);
}

/** The text node a list item's marker would live in, if it has one. */
function leadingTextNode(item: {
  children: Content[];
}): null | { type: string; value: unknown } {
  const head = item.children[0] as
    undefined | { children?: Content[]; type: string };
  if (head?.type !== "paragraph" || !head.children?.length) return null;

  const first = head.children[0] as { type: string; value?: unknown };
  if (first.type !== "text" || typeof first.value !== "string") return null;
  return first as { type: string; value: unknown };
}

/** Convert list item children (ensure listItem wrapping) */
function convertListItemChildren(
  children: Content[],
  schema: Schema,
  convertBlockChildren: ConvertBlockFn,
): PmNode[] {
  const result: PmNode[] = [];

  for (const child of children) {
    if (child.type === "listItem") {
      const item = child as { checked?: boolean | null; children: Content[] };

      // ‼️ `takeExtendedState` MUTATES — it strips the marker it read. It must
      // therefore run at most once per item, which is why the GFM branch short-
      // circuits it: `- [x] [/] literal` is a done task whose text happens to
      // start with `[/]`, and reading the extended marker there would eat it.
      const state: null | TaskState =
        item.checked == null
          ? takeExtendedState(item)
          : item.checked
            ? "done"
            : "todo";

      let innerChildren = convertBlockChildren(item.children, schema);
      // Empty items must have at least one paragraph for cursor placement
      if (innerChildren.length === 0) {
        innerChildren = [schema.nodes.paragraph.create()];
      }

      result.push(
        state === null
          ? schema.nodes.listItem.create(null, innerChildren)
          : schema.nodes.taskItem.create({ state }, innerChildren),
      );
    }
  }

  return result;
}
