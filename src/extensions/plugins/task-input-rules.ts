// §303 워드 트리거 입력 규칙 — 이모지를 직접 타이핑하지 않게 한다.
//
// 기호 트리거를 쓰지 않는 이유: @ #  [[ / ~~ $ ^ 가 전부 선점돼 있다.
// 트리거와 값을 ASCII로 제한한 것은 한글 IME 조합 중 오작동을 피하기 위해서다.

import type { EditorState } from "@tiptap/pm/state";

import { Extension, InputRule } from "@tiptap/core";

import { resolveDateInput } from "../../utils/tasks/task-date-input";
import {
  DATE_FIELDS,
  PRIORITY_DIGITS,
  PRIORITY_EMOJI,
  TRIGGER_BOUNDARY,
} from "../../utils/tasks/task-field-tokens";

/**
 * 이 매치를 발화시킨 문자가 Enter였는가.
 *
 * Tiptap의 입력 규칙 플러그인은 Enter에서도 규칙을 돌리는데, 이때 커서 앞
 * 텍스트에 `\n`을 붙여서 먹인다(`@tiptap/core` `inputRulesPlugin`의
 * `handleKeyDown`). 그래서 줄 끝 트리거는 `\s$`의 `\s`로 그 `\n`에 걸린다.
 *
 * 그 자체는 바라던 바다 — 트리거를 다 쓰고 Enter를 친 사용자도 변환을
 * 원한다. 문제는 규칙이 발화하면 플러그인이 keydown을 **가져가 버려서**
 * (`run()`이 true를 돌려주면 `handleKeyDown`도 true) 정작 항목이 나뉘지
 * 않는다는 것이다. 입력 규칙 플러그인이 keymap보다 앞에 있어 taskItem의
 * `Enter: splitListItem`은 아예 호출되지 않는다.
 *
 * 그래서 Enter로 발화했을 때는 변환과 함께 줄 나눔까지 이 체인이 직접
 * 한다. 한 트랜잭션이라 되돌리기도 한 번이다.
 */
function firedByEnter(match: RegExpMatchArray): boolean {
  return match[0].endsWith("\n");
}

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
    // 경계(`TRIGGER_BOUNDARY`)와 어휘는 캡처 저장 경로와 공유한다. 끝의 `\s$`만
    // 여기 고유다 — 입력 규칙은 스페이스를 치는 순간 발화한다(small fix #1).
    // 그 `\s`에는 Enter의 `\n`도 걸린다(`firedByEnter`).
    const rules: InputRule[] = DATE_FIELDS.map(
      ({ trigger, emoji }) =>
        new InputRule({
          find: new RegExp(`${TRIGGER_BOUNDARY}${trigger}:(\\S+)\\s$`),
          handler: ({ state, range, match, chain }) => {
            if (!insideTaskItem(state)) return null;
            const iso = resolveDateInput(match[1], new Date());
            if (!iso) return null;
            // 스페이스로 발화했으면 다음 낱말과 붙지 않게 공백을 남기고,
            // Enter로 발화했으면 줄이 여기서 끝나므로 남기지 않는다.
            const enter = firedByEnter(match);
            const commands = chain()
              .deleteRange(range)
              .insertContent(`${emoji}${iso}${enter ? "" : " "}`);
            if (enter) commands.splitListItem("taskItem");
            commands.run();
            return undefined;
          },
        }),
    );

    // prio:N 과 !N 두 표기를 같은 결과로 받는다. 3(보통)은 이모지가 없을
    // 뿐 트리거는 지워져야 한다 — `!emoji`가 아니라 매핑 존재 여부로 판정한다.
    rules.push(
      new InputRule({
        find: new RegExp(`${TRIGGER_BOUNDARY}${PRIORITY_DIGITS}\\s$`),
        handler: ({ state, range, match, chain }) => {
          if (!insideTaskItem(state)) return null;
          const emoji = PRIORITY_EMOJI[match[1]];
          if (emoji === undefined) return null;
          // 3(보통)은 이모지가 없다 — 트리거 앞의 구분 공백은 이미 있으므로
          // 여기서 또 공백을 남기면 이중 공백이 된다. 그냥 지운다.
          const enter = firedByEnter(match);
          const suffix = enter ? "" : " ";
          const commands = chain()
            .deleteRange(range)
            .insertContent(emoji ? `${emoji}${suffix}` : "");
          if (enter) commands.splitListItem("taskItem");
          commands.run();
          return undefined;
        },
      }),
    );

    return rules;
  },
});
