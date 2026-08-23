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

// "3" = normal priority → no emoji, but the trigger must still clear (small fix #3).
const PRIORITY_EMOJI: Record<string, string> = {
  "1": "🔺",
  "2": "⏫",
  "3": "",
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
    // (?<=^|\s) — 트리거 앞이 줄 시작이거나 공백이어야 한다. 폭 0 lookbehind라
    // range/match에 그 경계 문자가 섞이지 않는다. 이게 없으면 "overdue:8/30 "의
    // "due:"가 "over" 중간에서 걸려 "over📅2026-08-30 "이 돼버린다(small fix #1).
    const rules: InputRule[] = DATE_FIELDS.map(
      ({ trigger, emoji }) =>
        new InputRule({
          find: new RegExp(`(?<=^|\\s)${trigger}:(\\S+)\\s$`),
          handler: ({ state, range, match, chain }) => {
            if (!insideTaskItem(state)) return null;
            const iso = resolveDateInput(match[1], new Date());
            if (!iso) return null;
            chain().deleteRange(range).insertContent(`${emoji}${iso} `).run();
            return undefined;
          },
        }),
    );

    // prio:N 과 !N 두 표기를 같은 결과로 받는다. 3(보통)은 이모지가 없을
    // 뿐 트리거는 지워져야 한다 — `!emoji`가 아니라 매핑 존재 여부로 판정한다.
    for (const find of [
      /(?<=^|\s)prio:([12345])\s$/,
      /(?<=^|\s)!([12345])\s$/,
    ]) {
      rules.push(
        new InputRule({
          find,
          handler: ({ state, range, match, chain }) => {
            if (!insideTaskItem(state)) return null;
            const emoji = PRIORITY_EMOJI[match[1]];
            if (emoji === undefined) return null;
            // 3(보통)은 이모지가 없다 — 트리거 앞의 구분 공백은 이미 있으므로
            // 여기서 또 공백을 남기면 이중 공백이 된다. 그냥 지운다.
            chain()
              .deleteRange(range)
              .insertContent(emoji ? `${emoji} ` : "")
              .run();
            return undefined;
          },
        }),
      );
    }

    return rules;
  },
});
