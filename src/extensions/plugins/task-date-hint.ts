// §308 M3-c 태스크 줄에 날짜를 **말로** 적으면 알아보고, Tab이 확정한다.
//
// 설계(§18.11)가 든 근거: Todoist Quick Add의 핵심은 파서 성능이 아니라 **입력 중에 인식
// 결과를 보여주는 것**이다. 그래서 이 플러그인이 하는 일은 밑줄 하나와 Tab 하나뿐이고,
// 무엇이 날짜인지는 `natural-date.ts`가, 어디에 쓰는지는 `task-field-edit.ts`가 안다.
//
// 세 가지가 이 파일의 모양을 정한다:
//
// 1. **Tab은 목록 들여쓰기의 키다**(`task-item.ts`). 인식한 구간이 없으면 `false`를
//    돌려 그쪽으로 넘긴다 — ghost-text가 같은 키를 두고 쓰는 방식이다. 확장 등록 순서가
//    이 양보의 전제다: `index.ts`에서 `TaskItem`보다 **뒤에** 있어야 우리가 먼저 본다
//    (Tiptap이 확장 목록을 뒤집어 플러그인을 쌓는다).
// 2. **한글 조합 중에는 밑줄을 걸지 않는다.** 조합이 끝나기 전의 `내일`에 인라인
//    데코레이션을 씌우면 그 텍스트 노드가 span으로 감싸이면서 조합이 깨진다. 조합이
//    끝나면 그때 그린다.
// 3. **커서 앞의 텍스트 런만 본다.** 문단 전체의 `textContent`를 쓰면 인라인 노드가
//    자리를 먹어 오프셋이 밀린다(`taskLineText`가 있는 이유와 같은 함정).

import type { Locale } from "../../i18n";
import type { DateGuess } from "../../utils/tasks/natural-date";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { guessTrailingDate } from "../../utils/tasks/natural-date";
import { commitTaskField, taskLineTarget } from "./task-field-edit";
import { withVimExternalEdit } from "./vim/vim-keys";

/** 인식한 구간을 **문서 위치**로 옮겨 든 것. 없으면 `null`. */
export interface TaskDateHint {
  from: number;
  iso: string;
  to: number;
}

export const taskDateHintKey = new PluginKey<null | TaskDateHint>(
  "taskDateHint",
);

/** 밑줄 클래스 (`src/styles/tasks.css`). */
export const HINT_CLASS = "task-date-hint";

/**
 * 커서 앞에서 끝나는 날짜 표현을 찾아 **문서 위치**로 돌려준다.
 *
 * 텍스트는 `$from.nodeBefore`에서 가져온다 — 커서 바로 앞의 텍스트 런이다. 문단 전체를
 * 쓰지 않는 이유는 인라인 노드(`#tag`·`[[링크]]`)가 글자 없이 자리를 먹기 때문이고,
 * 런 단위로 보면 그 안에서는 오프셋이 곧 위치다(칩 플러그인이 쓰는 것과 같은 수법).
 */
export function findDateHint(
  state: EditorState,
  today: Date,
): null | TaskDateHint {
  // 태스크 기능을 통째로 끈 사용자에게는 밑줄도 Tab도 없다. Tab이 문서를 고치는 조작이라
  // `task-created-stamp.ts`와 같은 문을 지난다 — 껐는데 문서가 바뀌는 일이 없어야 한다.
  // 여기 한 곳만 막으면 밑줄이 사라지고, Tab은 `hint`가 없으므로 저절로 들여쓰기로 간다.
  if (!useSettingsStore.getState().tasksEnabled) return null;
  // 선택 구간이 있으면 확정할 대상이 모호하다. 커서일 때만 본다.
  if (!state.selection.empty) return null;
  // 태스크 줄이 아니면 쓸 곳이 없다 — 밑줄만 긋고 Tab이 아무것도 못 하는 상태가 된다.
  if (!taskLineTarget(state)) return null;

  const $from = state.selection.$from;
  const before = $from.nodeBefore;
  if (!before?.isText || !before.text) return null;

  const text = before.text;
  const guess: DateGuess | null = guessTrailingDate(text, text.length, today);
  if (!guess) return null;

  const runFrom = $from.pos - text.length;
  return { from: runFrom + guess.from, iso: guess.iso, to: runFrom + guess.to };
}

export const TaskDateHint = Extension.create({
  name: "taskDateHint",

  addProseMirrorPlugins() {
    return [createTaskDateHintPlugin()];
  },
});

/**
 * 실제 Plugin. 테스트가 raw `EditorView`에 직접 꽂을 수 있도록 따로 내보낸다
 * (`task-field-chips.ts`와 같은 이유).
 */
export function createTaskDateHintPlugin(): Plugin<null | TaskDateHint> {
  // ‼️ 조합 상태는 플러그인 상태가 아니라 여기 둔다. 상태에 두면 `compositionstart`에서
  // 트랜잭션을 하나 쏘아야 하는데, 조합이 막 시작된 순간의 디스패치가 바로 이 가드가
  // 막으려는 그 방해다. 플러그인 인스턴스는 에디터마다 새로 만들어지므로 이 변수도
  // 에디터마다 하나다.
  let composing = false;

  return new Plugin<null | TaskDateHint>({
    key: taskDateHintKey,
    props: {
      decorations(state) {
        const hint = taskDateHintKey.getState(state);
        if (!hint || composing) return DecorationSet.empty;
        const locale = useSettingsStore.getState().locale as Locale;
        return DecorationSet.create(state.doc, [
          Decoration.inline(hint.from, hint.to, {
            class: HINT_CLASS,
            title: t("tasks.dateHint.title", locale, { date: hint.iso }),
          }),
        ]);
      },
      handleDOMEvents: {
        compositionend: (view) => {
          composing = false;
          // 조합 중에는 데코레이션을 비워 두었으므로, 끝나면 다시 물어봐야 한다.
          // 문서도 선택도 그대로여서 이 meta가 없으면 아무도 다시 그리지 않는다.
          view.dispatch(view.state.tr.setMeta(taskDateHintKey, REDRAW));
          return false;
        },
        compositionstart: () => {
          composing = true;
          return false;
        },
      },
      handleKeyDown(view, event) {
        if (event.key !== "Tab" || event.shiftKey) return false;
        const hint = taskDateHintKey.getState(view.state);
        // 인식한 것이 없으면 Tab은 원래 주인(목록 들여쓰기)에게 간다.
        if (!hint) return false;
        event.preventDefault();
        confirmHint(view, hint);
        return true;
      },
    },
    state: {
      apply(tr, value, _oldState, newState) {
        if (
          !tr.docChanged &&
          !tr.selectionSet &&
          !tr.getMeta(taskDateHintKey)
        ) {
          return value;
        }
        return findDateHint(newState, new Date());
      },
      init(_config, state) {
        return findDateHint(state, new Date());
      },
    },
  });
}

/**
 * 확정 — 알아본 말을 지우고 그 자리에 `📅` 필드를 준다.
 *
 * 두 걸음인 것이 요점이다. 지우는 것은 문서 위치로 정확히 할 수 있고, 넣는 것은 §303
 * 자리를 알아야 하므로 줄 전체를 봐야 한다. 둘을 한 트랜잭션에 억지로 섞으면 위치 계산이
 * 두 번 어긋난다. 되돌리기는 갈라지지 않는다 — history 플러그인이 연달아 온 두
 * 트랜잭션을 한 묶음으로 센다.
 */
function confirmHint(view: EditorView, hint: TaskDateHint): void {
  // 앞의 구분 공백까지 가져간다 — 남기면 `회의  📅2026-09-17`처럼 두 칸이 된다.
  const eatsSpace =
    hint.from > 0 &&
    /\s/.test(view.state.doc.textBetween(hint.from - 1, hint.from));
  const cutFrom = eatsSpace ? hint.from - 1 : hint.from;
  view.dispatch(withVimExternalEdit(view.state.tr.delete(cutFrom, hint.to)));

  const line = taskLineTarget(view.state);
  if (line) commitTaskField(view, line, "due", hint.iso);
}

/** `apply`의 tr meta — 문서·선택이 그대로여도 다시 물어보라. */
const REDRAW = "redraw";
