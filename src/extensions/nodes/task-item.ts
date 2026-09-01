// §5.1 Task Item Extension
//
// §18.18 M4 widened this from a boolean to the four-state `TaskState`. The node
// carries ONE attribute, `state` — there is no `checked` beside it. Two
// attributes for one fact is how "done" would end up with two spellings
// (`checked: true` and `state: "done"`), and every reader would have to guess
// which one the writer used.

import type { Locale } from "../../i18n";
import type { TaskState } from "../../ipc/types";
import type { TaskFieldKind } from "../../utils/tasks/task-field-order";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { applyTaskField } from "../../utils/tasks/task-field-splice";
import { asTaskState, nextTaskState } from "../../utils/tasks/task-state";
import { resolveStateWrite } from "../../utils/tasks/task-state-write";
import { spliceFieldText, taskLineText } from "../plugins/task-field-edit";

export interface TaskItemOptions {
  HTMLAttributes: Record<string, string>;
  nested: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    taskItem: {
      /** Move the task under the cursor one step around the click ring. */
      cycleTaskState: () => ReturnType;
      /** Put the task under the cursor in an exact state (the menu path). */
      setTaskState: (state: TaskState) => ReturnType;
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
      state: {
        default: "todo" as TaskState,
        keepOnSplit: false,
        parseHTML: (element) => readState(element),
        // The node's own `renderHTML` writes `data-state`. Without this,
        // tiptap's default would ALSO emit a bare `state="doing"` attribute on
        // the `<li>` — a second spelling of the same fact in the exported HTML,
        // and one nothing reads back.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const state = asTaskState(node.attrs.state);
    const locale = useSettingsStore.getState().locale as Locale;

    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "taskItem",
        "data-state": state,
        // Derived, for interop only. Tiptap's own TaskItem — and every editor
        // that copied it — reads `data-checked`, so our exported HTML stays
        // parseable by them. Nothing in this app reads it back: `data-state`
        // is the fact, this is a projection of it.
        "data-checked": state === "done" ? "true" : "false",
      }),
      [
        // A `<button>`, not the `<label><input type="checkbox">` this used to
        // be: a checkbox has two states and a third only via `indeterminate`,
        // so it cannot tell `doing` from `cancelled` — in markup, in the
        // accessibility tree, or on screen. The state is painted from
        // `data-state` by CSS (editor/lists.css), and the accessible name says
        // which state it currently is.
        //
        // `role="checkbox"` is deliberately absent for the same reason: its
        // `mixed` value stops at three states, so claiming it would describe
        // this control inaccurately in exactly the case M4 added.
        "button",
        {
          "aria-label": t(`tasks.state.${state}`, locale),
          class: "task-checkbox",
          contenteditable: "false",
          "data-state": state,
          type: "button",
        },
      ],
      ["div", 0],
    ];
  },

  addCommands() {
    return {
      cycleTaskState:
        () =>
        ({ commands, state }) => {
          const found = taskItemAt(state.selection.$from);
          if (!found) return false;
          return commands.setTaskState(
            nextTaskState(asTaskState(found.node.attrs.state)),
          );
        },

      setTaskState:
        (next: TaskState) =>
        ({ dispatch, state, tr }) => {
          const found = taskItemAt(state.selection.$from);
          if (!found) return false;
          if (dispatch) writeState(tr, found, next);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("taskItemClick"),
        props: {
          handleDOMEvents: {
            // Two events, one rule. `click` is the only place the state
            // changes — it covers a mouse press AND a keyboard Enter/Space on
            // the focused button, which a mousedown handler would miss. What
            // `mousedown` is here for is the caret: without the
            // `preventDefault`, pressing the control moves focus to the button
            // and ProseMirror starts a selection, so the caret jumps out of the
            // line the user was editing.
            click: (view, event) => {
              const li = controlItem(view, event);
              if (!li) return false;

              event.preventDefault();
              const found = taskItemAtDOM(view, li);
              if (!found) return false;

              const tr = view.state.tr;
              writeState(
                tr,
                found,
                nextTaskState(asTaskState(found.node.attrs.state)),
              );
              view.dispatch(tr);
              return true;
            },

            mousedown: (view, event) => {
              if (!controlItem(view, event)) return false;
              event.preventDefault();
              return true;
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

/** A `taskItem` node together with the document position it sits at. */
interface FoundItem {
  node: PMNode;
  pos: number;
}

/**
 * The task item a press landed on, or `null` when the press was not on a
 * control — which is every ordinary click in the document, so this runs on the
 * hot path and does nothing but two `closest` calls.
 */
function controlItem(view: EditorView, event: Event): HTMLElement | null {
  if (!view.editable) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  if (!target.closest(".task-checkbox")) return null;
  return target.closest<HTMLElement>('li[data-type="taskItem"]');
}

/**
 * Read a state off an `<li>` being parsed.
 *
 * ‼️ The `data-checked` fallback is not decoration. HTML reaches this parser
 * from the clipboard and from files exported before M4, and in both a done task
 * says only `data-checked="true"` — without the fallback every one of them
 * would paste back as `todo`, silently un-completing the user's work.
 */
function readState(element: HTMLElement): TaskState {
  const state = element.getAttribute("data-state");
  if (state !== null) return asTaskState(state);
  return element.getAttribute("data-checked") === "true" ? "done" : "todo";
}

/**
 * The INNERMOST `taskItem` around a position — nested lists put one inside
 * another, and the one the user pressed is the deepest, not the outermost.
 */
function taskItemAt($pos: ResolvedPos): FoundItem | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "taskItem") return { node, pos: $pos.before(depth) };
  }
  return null;
}

/** The same lookup, starting from the item's DOM element. */
function taskItemAtDOM(view: EditorView, li: HTMLElement): FoundItem | null {
  return taskItemAt(view.state.doc.resolve(view.posAtDOM(li, 0)));
}

/**
 * Put a state change into `tr` — the attribute AND every field it moves:
 * §18.18 M4's `⏱`, and §318's rolled dates.
 *
 * ‼️ ONE transaction, deliberately. A single press does several things now, and
 * separate transactions would let one Ctrl+Z undo half of it: a `[/]` line whose
 * clock has already been banked, or a rolled line whose dates moved but whose
 * checkbox did not.
 *
 * The attribute change does not shift any position (attrs only), so the text
 * edit that follows can use positions read from the pre-change document.
 *
 * ‼️ 무엇을 쓸지는 여기서 정하지 않는다 — `resolveStateWrite`가 정하고, 아젠다
 * 경로(`task-triage.ts`)가 같은 함수를 부른다. 두 표면이 같은 조작에 다르게
 * 반응하지 않게 하는 유일한 장치다.
 */
function writeState(tr: Transaction, found: FoundItem, next: TaskState): void {
  const line = found.node.firstChild;
  const before = line?.type.name === "paragraph" ? taskLineText(line) : "";
  const write = resolveStateWrite(next, before, {
    now: new Date(),
    // 이 경로는 종료 스탬프를 찍지 않는다 — 그 설정은 디스크 경로의 것이고, 여기서
    // 쓰는 것은 `resolveStateWrite`가 굴리기 때문에 참으로 올려 준 값뿐이다.
    recordDoneDate: false,
    trackTime: useSettingsStore.getState().tasksTrackTime,
  });

  tr.setNodeMarkup(found.pos, undefined, {
    ...found.node.attrs,
    state: write.newState,
  });
  if (line?.type.name !== "paragraph") return;

  let after = before;
  if (write.timer !== null) {
    after = applyTaskField(after, "timer", write.timer);
  }
  for (const [kind, value] of Object.entries(write.dates ?? {})) {
    after = applyTaskField(after, kind as TaskFieldKind, value);
  }
  // §318 굴린 줄은 완료가 아니다 — 남아 있던 종료 스탬프를 뗀다. 디스크 경로에서
  // `apply_state`가 `record_done_date: true`로 하는 그 일을 여기서 손으로 한다.
  if (write.roll) {
    after = applyTaskField(after, "cancelled", "");
    after = applyTaskField(after, "done", "");
  }
  if (after === before) return;

  // `found.pos + 2`가 첫 문단 **내용**의 시작이다(항목 +1 = 문단, +1 = 그 내용) —
  // `taskLineTarget`이 쓰는 것과 같은 산술.
  spliceFieldText(tr, found.pos + 2, before, after);

  if (write.roll) {
    const locale = useSettingsStore.getState().locale as Locale;
    useUIStore
      .getState()
      .showToast(
        t("tasks.recurrence.rolled", locale, { date: write.roll.next }),
        "info",
      );
  }
}
