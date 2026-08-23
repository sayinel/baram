// §303 워드 트리거 입력 규칙 — 이모지를 직접 타이핑하지 않게 한다.
//
// 기호 트리거를 쓰지 않는 이유: @ #  [[ / ~~ $ ^ 가 전부 선점돼 있다.
// 트리거와 값을 ASCII로 제한한 것은 한글 IME 조합 중 오작동을 피하기 위해서다.

import type { EditorState } from "@tiptap/pm/state";

import { Extension, InputRule } from "@tiptap/core";

import { resolveDateInput } from "../../utils/tasks/task-date-input";

const DATE_FIELDS: { emoji: string; trigger: string }[] = [
  { trigger: "start", emoji: "🛫" },
  { trigger: "sched", emoji: "⏳" },
  { trigger: "due", emoji: "📅" },
];

const PRIORITY_EMOJI: Record<string, string> = {
  "1": "🔺",
  "2": "⏫",
  "4": "🔽",
  "5": "⏬",
};

/** 커서가 taskItem 안에 있을 때만 true. */
function insideTaskItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "taskItem") return true;
  }
  return false;
}

export const TaskInputRules = Extension.create({
  name: "taskInputRules",

  addInputRules() {
    const rules: InputRule[] = DATE_FIELDS.map(
      ({ trigger, emoji }) =>
        new InputRule({
          find: new RegExp(`${trigger}:(\\S+)\\s$`),
          handler: ({ state, range, match, chain }) => {
            if (!insideTaskItem(state)) return null;
            const iso = resolveDateInput(match[1], new Date());
            if (!iso) return null;
            chain().deleteRange(range).insertContent(`${emoji}${iso} `).run();
            return undefined;
          },
        }),
    );

    // prio:N 과 !N 두 표기를 같은 결과로 받는다.
    for (const find of [/prio:([1245])\s$/, /!([1245])\s$/]) {
      rules.push(
        new InputRule({
          find,
          handler: ({ state, range, match, chain }) => {
            if (!insideTaskItem(state)) return null;
            const emoji = PRIORITY_EMOJI[match[1]];
            if (!emoji) return null;
            chain().deleteRange(range).insertContent(`${emoji} `).run();
            return undefined;
          },
        }),
      );
    }

    return rules;
  },
});
