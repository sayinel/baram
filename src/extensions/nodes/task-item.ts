// §5.1 Task Item Extension
//
// §18.18 M4 widened this from a boolean to the four-state `TaskState`. The node
// carries ONE attribute, `state` — there is no `checked` beside it. Two
// attributes for one fact is how "done" would end up with two spellings
// (`checked: true` and `state: "done"`), and every reader would have to guess
// which one the writer used.

import type { Locale } from "../../i18n";
import type { TaskState } from "../../ipc/types";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { scanTaskFields } from "../../utils/tasks/task-field-scan";
import { applyTaskField } from "../../utils/tasks/task-field-splice";
import { asTaskState, nextTaskState } from "../../utils/tasks/task-state";
import { timerForState } from "../../utils/tasks/task-timer";
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
 * Put a state change into `tr` — the attribute AND the `⏱` field it moves.
 *
 * ‼️ ONE transaction, deliberately. §18.18 M4 made a single press do two things,
 * and two transactions would let one Ctrl+Z undo half of it: a `[/]` line whose
 * clock has already been banked, or a `[x]` line still running one.
 *
 * The attribute change does not shift any position (attrs only), so the text
 * edit that follows can use positions read from the pre-change document.
 */
function writeState(tr: Transaction, found: FoundItem, next: TaskState): void {
  tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, state: next });

  if (!useSettingsStore.getState().tasksTrackTime) return;
  const line = found.node.firstChild;
  if (line?.type.name !== "paragraph") return;

  const before = taskLineText(line);
  const current =
    scanTaskFields(before).find((span) => span.kind === "timer")?.value ?? "0m";
  const value = timerForState(current, next, new Date());
  // `found.pos + 2`가 첫 문단 **내용**의 시작이다(항목 +1 = 문단, +1 = 그 내용) —
  // `taskLineTarget`이 쓰는 것과 같은 산술.
  spliceFieldText(
    tr,
    found.pos + 2,
    before,
    applyTaskField(before, "timer", value),
  );
}
