import type { SlashMenuItem } from "../../components/command/slash-menu-item";
import type { TaskFieldKind } from "../../utils/tasks/task-field-order";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";
import { extractActionItems } from "../../utils/tasks/extract-action-items";
import {
  askTaskField,
  commitTaskField,
  currentTaskField,
  taskLineTarget,
} from "./task-field-edit";
import { chainWithVimExternalEdit, withVimExternalEdit } from "./vim/vim-keys";

export function buildTaskItems(editor: Editor): SlashMenuItem[] {
  // §308 M3-b 태스크 줄의 필드 — 커서가 태스크 줄에 있을 때만 보인다.
  //
  // 조건부인 것이 요점이다. 언제나 보이면 문단 한가운데서 고른 사용자에게 아무 일도
  // 일어나지 않는 항목이 둘 생기고, 그것은 "눌렀는데 안 된다"로 읽힌다. `buildSlashItems`는
  // 질의마다 다시 불리므로 여기서 지금의 선택을 보면 된다.
  //
  // 여기서 잡은 대상을 **들고 있지 않는** 것도 의도다. 아래 action이 그것을 닫아 쓰면
  // Suggestion이 그 사이에 `/due` 글자를 지우므로 원문이 낡는다(`setTaskFieldFromSlash`
  // 주석). 값을 남기지 않으면 그 실수를 할 자리가 없다.
  const gated: SlashMenuItem[] = taskLineTarget(editor.state)
    ? [
        // ‼️ 날짜 셋이 함께 있다. `/due`만 두면 나머지 둘은 `sched:`·`start:` 입력 규칙을
        // 아는 사람만 쓸 수 있는데, 그 규칙을 몰라서 메뉴를 여는 사람이 바로 이 메뉴의
        // 사용자다 — 세 필드가 §303 표에서 같은 자리에 있는 이상 메뉴에서도 같이 있어야 한다.
        ...DATE_FIELDS.map(({ hint, id, kind, label }) => ({
          id,
          label,
          category: "Tasks",
          description: `Pick this task's ${label.toLowerCase()}`,
          mdHint: hint,
          action: () => setTaskFieldFromSlash(editor, kind),
        })),
        {
          id: "priority",
          label: "Priority",
          category: "Tasks",
          description: "Set this task's priority",
          mdHint: "⏫",
          action: () => setTaskFieldFromSlash(editor, "priority"),
        },
        // §18.18 M4 — 반복만 입력 규칙(`due:`·`!2`)으로 넣을 수 없다. 그쪽 패턴이
        // `(\S+)`이라 공백을 못 받는데 이 필드의 값은 `every week on Monday`처럼
        // 띄어쓰기가 본질이다. 그래서 메뉴가 유일한 입력 경로다.
        {
          id: "repeat",
          label: "Repeat",
          category: "Tasks",
          description: "Set how often this task repeats",
          mdHint: "🔁",
          action: () => setTaskFieldFromSlash(editor, "recurrence"),
        },
        // §18.18 M4 — the ONLY way to reach `cancelled` from the editor. The
        // checkbox cycles todo → doing → done, deliberately leaving cancelled
        // off the ring (utils/tasks/task-state.ts), so without this entry the
        // state would be writable by hand and by nothing else.
        {
          id: "cancel-task",
          label: "Cancel Task",
          category: "Tasks",
          description: "Mark this task cancelled, keeping the line",
          mdHint: "[-]",
          action: () =>
            chainWithVimExternalEdit(editor)
              .focus()
              .setTaskState("cancelled")
              .run(),
        },
      ]
    : [];

  // §314 회의록에서 할 일 뽑기. 태스크 줄 위가 아니라 **어디서나** 쓸 수 있어야 한다 —
  // 뽑는 대상이 태스크가 아니라 그 위의 산문이기 때문이다.
  const extractTasks: SlashMenuItem = {
    id: "extract-tasks",
    label: "Extract Action Items",
    category: "Tasks",
    description: "Pull to-dos out of the selection with AI",
    mdHint: "AI",
    action: () => {
      void extractActionItems(editor);
    },
  };

  return [...gated, extractTasks];
}

/**
 * §303 표의 날짜 필드 셋. `id`가 곧 사용자가 치는 말이다(`/due`·`/sched`·`/start`) —
 * 입력 규칙의 트리거(`due:`·`sched:`·`start:`)와 같은 말이라, 메뉴에서 배운 이름을
 * 그대로 빠른 길에 쓸 수 있다.
 */
const DATE_FIELDS: {
  hint: string;
  id: string;
  kind: TaskFieldKind;
  label: string;
}[] = [
  { hint: "📅", id: "due", kind: "due", label: "Due Date" },
  { hint: "⏳", id: "sched", kind: "scheduled", label: "Scheduled Date" },
  { hint: "🛫", id: "start", kind: "start", label: "Start Date" },
];

/**
 * §308 M3-b `/due`·`/sched`·`/start`·`/priority`의 몸통.
 *
 * ‼️ 대상은 **여기서** 다시 잡는다. 메뉴를 지을 때 잡아 두면 그 사이에 Suggestion이
 * `/due` 글자를 지우므로(`slash-command.ts`의 `command`) 캡처한 원문이 낡고, 낙관적
 * 잠금이 매번 걸려 아무것도 쓰이지 않는다.
 */
async function setTaskFieldFromSlash(
  editor: Editor,
  kind: TaskFieldKind,
): Promise<void> {
  const view = editor.view;
  const line = taskLineTarget(view.state);
  if (!line) return;
  // §12-9b dialog gap — 문서가 바뀌었으면 `null`로 돌아온다(design §5c).
  const next = await awaitBoundToEditor(
    view,
    askTaskField(kind, currentTaskField(line.paragraphText, kind)),
  );
  if (next === null) return;
  if (!commitTaskField(view, line, kind, next)) return;

  // ‼️ 커서를 그 줄로 돌려놓는다. 모달이 포커스를 가져갔다가 닫히면 포커스는 `body`로
  // 떨어지고, 사용자는 방금 고친 줄에서 이어 쓰려다 다시 눌러야 한다 — 슬래시 커맨드는
  // **타이핑 중에** 부르는 것이라 그 끊김이 곧 이 명령을 쓰지 않을 이유가 된다.
  // 칩 클릭은 이것을 하지 않는다: 거기서는 커서가 애초에 다른 곳에 있었고, 그 줄로
  // 옮기는 순간 방금 고친 칩이 원문으로 돌아간다.
  focusTaskLineEnd(view, line.paragraphFrom);
}

/** 문단 끝에 커서를 놓고 에디터에 포커스를 준다. */
function focusTaskLineEnd(view: EditorView, paragraphFrom: number): void {
  const { doc } = view.state;
  if (paragraphFrom < 0 || paragraphFrom > doc.content.size) return;
  const $at = doc.resolve(paragraphFrom);
  const end = Math.min($at.end(), doc.content.size);
  view.dispatch(
    withVimExternalEdit(
      view.state.tr.setSelection(TextSelection.create(doc, end)),
    ),
  );
  // bare `view.focus()`는 non-editable 뷰에서 no-op다(CLAUDE.md).
  focusEditorView(view);
}
