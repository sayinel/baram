import type { TaskState } from "../../ipc/types";
import type { NodeTransformerEntry, TaskCheckboxNode } from "../types";
// task-list-transformer.ts — §5.1 Task List mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type {
  List,
  ListItem,
  Node as MdastNode,
  Paragraph,
  RootContent,
} from "mdast";

import { TASK_STATE_MARKER } from "../../ipc/types";
import { asTaskState } from "../../utils/tasks/task-state";

/**
 * §7.1: 첫 문단이 빈 task item이면 체크박스를 직접 써 넣는다.
 *
 * remark-gfm의 listItem 핸들러는 기본 핸들러가 만든 줄에
 * `^(?:[*+-]|\d+\.)([\r\n]| {1,3})` 를 걸어 그 뒤에 `[ ] ` 를 끼워 넣는다.
 * 불릿 뒤에 아무 글자도 없는 빈 항목에서는 이 정규식이 걸리지 않아
 * 체크박스가 **통째로 사라지고**(`- [ ] a` + 빈 항목 → `- [ ] a\n-\n`),
 * 뒤에 다른 블록이 있으면 체크박스가 열 0의 제 줄로 흘러
 * 리스트 구조까지 깨진다(`-\n[ ] \n  more\n`).
 *
 * 그래서 그런 항목만 미리 직렬화한 `taskCheckbox` 노드로 체크박스를 넣고
 * mdast의 `checked` 는 비운다 — 남겨두면 gfm이 한 번 더 손을 댄다.
 * 파싱 쪽 대칭 처리는 `parse-mdast.ts` 의 `normalizeEmptyTaskItems` 다.
 */
function writeCheckboxIntoEmptyItem(
  children: MdastNode[],
  checked: boolean,
): boolean {
  const head = children[0] as Paragraph | undefined;
  if (!head || head.type !== "paragraph" || head.children.length > 0) {
    return false;
  }
  head.children = [
    {
      type: "taskCheckbox",
      value: checked ? "[x]" : "[ ]",
    } as TaskCheckboxNode,
  ];
  return true;
}

/**
 * §18.18 M4 — put `[/] ` (or `[-] `) at the head of an extended task item.
 *
 * Prepends rather than replacing: unlike the empty-item case above, this line
 * has content, and the marker is a prefix to it. The trailing space is part of
 * the marker — it is what `convert-list`'s reader requires to tell a state from
 * an ordinary bracketed word like `[TODO]`.
 *
 * Returns whether it wrote, so the caller knows to leave `checked` off.
 */
function writeStateMarker(children: MdastNode[], state: TaskState): boolean {
  const head = children[0] as Paragraph | undefined;
  if (!head || head.type !== "paragraph") return false;

  head.children = [
    {
      type: "taskCheckbox",
      value: `[${TASK_STATE_MARKER[state]}]`,
    } as TaskCheckboxNode,
    { type: "text", value: " " } as MdastNode,
    ...head.children,
  ] as Paragraph["children"];
  return true;
}

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
      let itemChildren = convertChildren(child);
      if (itemChildren.length === 0) {
        itemChildren = [schema.nodes.paragraph.create()];
      }
      return schema.nodes.taskItem.create(
        { state: child.checked ? "done" : "todo" },
        itemChildren,
      );
    });

    return schema.nodes.taskList.create(null, pmChildren);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    const children: ListItem[] = [];
    node.forEach((child) => {
      const state = asTaskState(child.attrs.state);
      const itemChildren = convertChildren(child);

      // §18.18 M4: `[/]` and `[-]` are not GFM, so `checked` cannot carry them
      // and remark would escape a literal `[` at the head of a list item into
      // `\[/]` — the design measured exactly that. Write the marker as a
      // verbatim `taskCheckbox` node instead (the serializer passes those
      // through untouched) and leave `checked` off so gfm adds nothing of its
      // own. The same escape hatch already existed for empty task items.
      const gfm = state === "done" || state === "todo";
      const written = gfm
        ? writeCheckboxIntoEmptyItem(itemChildren, state === "done")
        : writeStateMarker(itemChildren, state);

      children.push({
        type: "listItem",
        // 체크박스를 직접 써 넣었으면 gfm이 또 붙이지 않게 비워 둔다
        ...(written ? {} : { checked: state === "done" }),
        spread: false,
        children: itemChildren as RootContent[],
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
