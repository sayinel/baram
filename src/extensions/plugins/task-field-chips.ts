// §308 표시 절반 — 태스크 메타데이터를 칩으로 보인다.
//
// **문서 모델을 바꾸지 않는다.** 파생 속성 + NodeView(스펙 §18.11의 문구)는 md→pm에서
// 이모지를 텍스트에서 떼어내고 pm→md에서 다시 붙여야 하므로, 태스크가 있는 모든 문서의
// 바이트가 편집할 때마다 직렬화기를 통과한다. 이 프로젝트의 최우선 품질 기준이
// 라운드트립 정확 일치이므로 그 위험을 표시 기능 하나에 지불하지 않는다.
// 속성 전환은 칩을 **눌러 편집**하게 되는 M3의 몫이다.

import type { TaskFieldSpan } from "../../utils/tasks/task-field-scan";
import type { Node as PMNode } from "@tiptap/pm/model";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { scanTaskFields } from "../../utils/tasks/task-field-scan";

interface TaskFieldChipsState {
  /** 커서가 든 가장 안쪽 `taskItem`의 위치. 없으면 -1. */
  editingItem: number;
  set: DecorationSet;
}

export const taskFieldChipsKey = new PluginKey<TaskFieldChipsState>(
  "taskFieldChips",
);

/** 원문 이모지 필드를 가리는 구간. 실제 스타일은 §308 Task 3의 CSS가 준다. */
const RAW_CLASS = "task-field-raw";

/**
 * `selectionFrom`이 든 `taskItem`은 건너뛴다 — 원문이 보여야 고칠 수 있다.
 * `-1`이면 어떤 것도 건너뛰지 않는다(테스트용).
 */
export function buildTaskFieldDecorations(
  doc: PMNode,
  selectionFrom: number,
  today: Date,
): DecorationSet {
  const decorations: Decoration[] = [];
  const editingItem = findEditingTaskItem(doc, selectionFrom);

  doc.descendants((node, pos) => {
    // 텍스트블록 안에는 taskItem이 있을 수 없다. 인라인까지 훑지 않는 것만으로
    // 큰 문서의 순회 비용 대부분이 사라진다.
    if (node.isTextblock) return false;
    if (node.type.name !== "taskItem") return true;
    if (pos !== editingItem) collectItem(node, pos, today, decorations);
    // 계속 내려간다 — 중첩 taskItem은 저마다 하나의 항목이다.
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * `selectionFrom`을 담은 **가장 안쪽** `taskItem`의 위치. 없으면 -1.
 *
 * 가장 안쪽이어야 한다: 중첩 태스크에서 안쪽 줄을 고치는 동안 바깥 줄의 칩까지
 * 원문으로 되돌아가면 화면이 통째로 출렁인다.
 */
export function findEditingTaskItem(
  doc: PMNode,
  selectionFrom: number,
): number {
  if (selectionFrom < 0 || selectionFrom > doc.content.size) return -1;
  const $pos = doc.resolve(selectionFrom);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === "taskItem") return $pos.before(depth);
  }
  return -1;
}

/**
 * 칩 하나를 그린다.
 *
 * `data-vim-suspend`를 **붙이지 않는다**: 그 마커는 "이 섬이 키를 소유한다"는
 * 선언이라(`src/extensions/CLAUDE.md` §298 규약) 키를 전혀 받지 않는 칩에 붙이면
 * vim 사용자가 그 줄에서 타이핑을 잃는다. 칩을 눌러 고치게 되는 M3에서 다시 본다.
 *
 * `aria-hidden`인 이유는 원문 텍스트가 문서에 그대로 남아 있기 때문이다 — 칩은
 * 같은 정보의 시각적 중복이다. 따라서 Task 3의 `.task-field-raw`는 원문을
 * `display:none`으로 지우면 안 된다(그러면 보조기술에서 정보가 통째로 사라진다).
 */
export function renderTaskChip(
  span: TaskFieldSpan,
  overdue: boolean,
): HTMLElement {
  const el = document.createElement("span");
  el.className = "task-chip";
  if (overdue) el.classList.add("task-chip-overdue");
  if (span.kind === "priority") el.classList.add("task-chip-priority");
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";

  const glyph = document.createElement("span");
  glyph.className = "task-chip-glyph";
  // 이모지는 span이 들고 온 것을 쓴다 — UTF-16 길이가 제각각이라 텍스트에서
  // 고정 길이로 잘라내면 틀린다.
  glyph.textContent = span.emoji;
  el.append(glyph);

  if (span.kind !== "priority") {
    el.append(document.createTextNode(shortDate(span.value)));
  }
  return el;
}

function collectItem(
  item: PMNode,
  itemFrom: number,
  today: Date,
  out: Decoration[],
): void {
  item.descendants((child, childPos) => {
    // 중첩 태스크 목록은 바깥 walk가 저마다 따로 방문한다 — 여기서 삼키면
    // 커서 판정이 안쪽 줄까지 통째로 덮어버린다.
    if (child.type.name === "taskList") return false;
    if (!child.isTextblock) return true;
    // `itemFrom + 1`이 taskItem 내용의 시작이고 `childPos`가 그로부터의
    // 상대 위치이므로, 둘을 더하면 텍스트블록 노드의 절대 위치가 된다.
    collectTextblock(child, itemFrom + 1 + childPos, today, out);
    return false;
  });
}

/**
 * 한 텍스트블록에서 필드 구간을 찾는다.
 *
 * `textContent`를 통째로 훑지 **않는다**: hardBreak·수식·위키링크 같은 인라인
 * 노드는 문자를 하나도 내놓지 않으면서 위치는 한 칸 차지하므로, 그 뒤 필드의
 * 오프셋이 노드 수만큼 밀린다. 게다가 구분자가 없어 `⏳`와 다음 줄의 날짜가 한
 * 필드로 붙어버린다. 그래서 **인접한 텍스트 노드의 런** 단위로 훑는다 — 스캐너에
 * 넘기는 입력을 좁힐 뿐, 스캐너의 규칙은 건드리지 않는다.
 */
function collectTextblock(
  block: PMNode,
  blockPos: number,
  today: Date,
  out: Decoration[],
): void {
  const base = blockPos + 1; // 텍스트블록 내부의 첫 위치
  let runStart = 0;
  let runText = "";
  let offset = 0;

  const flush = (): void => {
    if (runText === "") return;
    for (const span of scanTaskFields(runText)) {
      pushSpan(span, base + runStart, today, out);
    }
    runText = "";
  };

  block.forEach((child) => {
    if (child.isText) {
      if (runText === "") runStart = offset;
      runText += child.text ?? "";
    } else {
      flush();
    }
    offset += child.nodeSize;
  });
  flush();
}

function isOverdue(span: TaskFieldSpan, today: Date): boolean {
  if (span.kind !== "due") return false;
  const [y, m, d] = span.value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() < startOfDay(today).getTime();
}

function nextState(
  doc: PMNode,
  selectionFrom: number,
  editingItem: number,
): TaskFieldChipsState {
  return {
    editingItem,
    set: buildTaskFieldDecorations(doc, selectionFrom, new Date()),
  };
}

function pushSpan(
  span: TaskFieldSpan,
  base: number,
  today: Date,
  out: Decoration[],
): void {
  const from = base + span.from;
  const to = base + span.to;
  const overdue = isOverdue(span, today);

  out.push(Decoration.inline(from, to, { class: RAW_CLASS }));
  out.push(
    Decoration.widget(to, () => renderTaskChip(span, overdue), {
      key: `task-chip-${from}-${span.kind}`,
      // 테스트가 DOM을 그리지 않고도 계약을 볼 수 있도록 spec에 남긴다.
      overdue,
      side: 1,
    }),
  );
}

/** `2026-08-30` → `8/30`. 연도는 접는다 — 줄이 길어지고 대개 같은 해다. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export const TaskFieldChips = Extension.create({
  name: "taskFieldChips",

  addProseMirrorPlugins() {
    return [
      new Plugin<TaskFieldChipsState>({
        key: taskFieldChipsKey,
        props: {
          decorations(state) {
            return taskFieldChipsKey.getState(state)?.set;
          },
        },
        state: {
          init(_config, state) {
            return nextState(
              state.doc,
              state.selection.from,
              findEditingTaskItem(state.doc, state.selection.from),
            );
          },
          // 문서가 그대로이고 편집 중인 항목도 그대로면 이전 집합을 그대로 쓴다.
          // 태스크 밖에서 커서만 움직일 때 문서 전체를 다시 훑지 않기 위해서다.
          apply(tr, value, _oldState, newState) {
            const editingItem = findEditingTaskItem(
              newState.doc,
              newState.selection.from,
            );
            if (!tr.docChanged && editingItem === value.editingItem) {
              return value;
            }
            return nextState(
              newState.doc,
              newState.selection.from,
              editingItem,
            );
          },
        },
      }),
    ];
  },
});
