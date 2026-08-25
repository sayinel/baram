// §308 표시 절반 — 태스크 메타데이터를 칩으로 보인다.
//
// **문서 모델을 바꾸지 않는다.** 파생 속성 + NodeView(스펙 §18.11의 문구)는 md→pm에서
// 이모지를 텍스트에서 떼어내고 pm→md에서 다시 붙여야 하므로, 태스크가 있는 모든 문서의
// 바이트가 편집할 때마다 직렬화기를 통과한다. 이 프로젝트의 최우선 품질 기준이
// 라운드트립 정확 일치이므로 그 위험을 표시 기능 하나에 지불하지 않는다.
// 속성 전환은 칩을 **눌러 편집**하게 되는 M3의 몫이다.

import type { Locale } from "../../i18n";
import type {
  TaskFieldKind,
  TaskFieldSpan,
} from "../../utils/tasks/task-field-scan";
import type { Node as PMNode } from "@tiptap/pm/model";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { scanTaskFields } from "../../utils/tasks/task-field-scan";
import { PRIORITY_EMOJI } from "../../utils/tasks/task-field-tokens";

interface TaskFieldChipsState {
  /** 커서가 든 가장 안쪽 `taskItem`의 위치. 없으면 -1. */
  editingItem: number;
  set: DecorationSet;
}

export const taskFieldChipsKey = new PluginKey<TaskFieldChipsState>(
  "taskFieldChips",
);

/**
 * 원문 이모지 필드를 가리는 구간. **무엇**을 가리는지만 말한다 — 이름 그대로
 * 의미 표지이고, 감추는 일은 아래 [[RAW_HIDE_CLASS]]가 맡는다.
 */
export const RAW_CLASS = "task-field-raw";

/**
 * 실제로 감추는 공용 유틸리티(`src/styles/base.css`).
 *
 * `display: none`이 **아니어야 한다**. 칩은 `aria-hidden`이라(원문이 문서에
 * 남아 있다는 것이 그 근거다) 원문까지 접근성 트리에서 지우면 스크린리더
 * 사용자에게 마감·우선순위·시작일이 통째로 사라진다. 커서가 그 항목에 들어간
 * 동안에만 되살아나므로 화면을 훑어 읽는 방식으로는 영영 닿지 못한다.
 */
export const RAW_HIDE_CLASS = "visually-hidden";

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
  // `NodeSelection`으로 `taskItem` 자체를 고르면 `selection.from`이 그 항목
  // **자신의** 위치라 조상 사슬에는 항목이 없다. 그 자리의 노드를 직접 본다.
  if (doc.nodeAt(selectionFrom)?.type.name === "taskItem") return selectionFrom;
  return -1;
}

/** 날짜 필드 종류 → i18n 키. 우선순위는 별도 표(아래)로 간다. */
const DATE_CHIP_KEY: Record<Exclude<TaskFieldKind, "priority">, string> = {
  cancelled: "tasks.chip.cancelled",
  created: "tasks.chip.created",
  done: "tasks.chip.done",
  due: "tasks.chip.due",
  scheduled: "tasks.chip.scheduled",
  start: "tasks.chip.start",
};

/**
 * 우선순위 마커(`task-field-tokens.ts`의 `PRIORITY_EMOJI`) → i18n 키 접미사.
 * "3"(보통)은 마커가 없어 `scanTaskFields`가 애초에 span을 만들지 않으므로
 * 여기 없다.
 */
const PRIORITY_CHIP_KEY: Record<string, string> = {
  [PRIORITY_EMOJI["1"]]: "highest",
  [PRIORITY_EMOJI["2"]]: "high",
  [PRIORITY_EMOJI["4"]]: "low",
  [PRIORITY_EMOJI["5"]]: "lowest",
};

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
  // 색을 갖는 상태는 기한 초과 하나뿐이다(방향 C, §308) — 점과 글자 모두
  // `.task-chip-overdue`의 currentColor를 탄다(tasks.css).
  if (overdue) el.classList.add("task-chip-overdue");
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.append(document.createTextNode(chipLabel(span)));
  return el;
}

/**
 * 칩에 보일 라벨. 이모지를 그대로 보이는 대신 로케일별 어순의 텍스트로
 * 읽는다(방향 C — ko `8/30 기한`, en `due 8/30`).
 *
 * ProseMirror 위젯이라 React 훅을 못 쓴다 — `useSettingsStore.getState()`로
 * 직접 읽는다(`drop-handler.ts:401`과 같은 관용구).
 */
function chipLabel(span: TaskFieldSpan): string {
  const { locale } = useSettingsStore.getState();
  if (span.kind === "priority") {
    // 마커 자체(span.value)로 매핑한다 — UTF-16 길이로 자르지 않는다.
    const key = PRIORITY_CHIP_KEY[span.value];
    return key ? t(`tasks.chip.priority.${key}`, locale as Locale) : "";
  }
  return t(DATE_CHIP_KEY[span.kind], locale as Locale, {
    date: shortDate(span.value),
  });
}

/**
 * 이 항목의 **태스크 줄** — 항목의 첫 문단 — 에서만 필드를 찾는다.
 *
 * 허용 목록인 것이 요점이다. `taskItem`의 content는 `paragraph block*`이라
 * 콜아웃·표·헤딩·각주 정의·정의 목록·인용구·코드블록·중첩 목록이 전부 그 **안에**
 * 들어올 수 있는데, "태스크 줄이 아닌 것"을 이름으로 열거하면 목록에 없는 블록이
 * 조용히 새고 새 블록 타입이 생길 때마다 다시 샌다. 실제로 그렇게 샜다:
 * `blockquote`는 막혔지만 사용자가 메모에 쓰는 `> [!note]`는 파이프라인이
 * 콜아웃으로 바꾸므로 그대로 지나갔다.
 *
 * 이어 적은 두 번째 문단도 태스크 줄이 아니다 — Rust 인덱서(`task/parse.rs:8-9`)가
 * `- [ ]`로 시작하는 그 한 줄만 파싱하므로, 그 아래 적은 날짜는 아젠다에서 이
 * 태스크의 마감이 아니다. 거기에 칩을 그리면 에디터만 없는 사실을 말하게 된다.
 * (§316 — 자리가 의미를 결정한다.)
 */
function collectItem(
  item: PMNode,
  itemFrom: number,
  today: Date,
  out: Decoration[],
): void {
  const line = item.firstChild;
  if (line?.type.name !== "paragraph") return;
  // `itemFrom + 1`이 taskItem 내용의 시작 = 첫 자식의 절대 위치다.
  collectTextblock(line, itemFrom + 1, today, out);
}

/**
 * 한 텍스트블록에서 필드 구간을 찾는다.
 *
 * `textContent`를 통째로 훑지 **않는다**: hardBreak·수식·위키링크 같은 인라인
 * 노드는 문자를 하나도 내놓지 않으면서 위치는 한 칸 차지하므로, 그 뒤 필드의
 * 오프셋이 노드 수만큼 밀린다. 게다가 구분자가 없어 `⏳`와 다음 줄의 날짜가 한
 * 필드로 붙어버린다. 그래서 **인접한 텍스트 노드의 런** 단위로 훑는다 — 스캐너에
 * 넘기는 입력을 좁힐 뿐, 스캐너의 규칙은 건드리지 않는다.
 *
 * 인라인 코드도 런을 끊는다. `collectItem`이 블록 코드에 대해 막는 것과 같은
 * 손실이 인라인에서 일어나기 때문이다 — 다만 인라인 코드는 별도 노드가 아니라
 * `code` 마크가 붙은 텍스트 노드라(`src/pipeline/md-to-pm.ts:631-636`) 노드
 * 종류만 보는 가드에는 닿지 않는다.
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
    // 코드 텍스트를 런에서 빼기만 하고 **끊지 않으면** 두 가지가 동시에 깨진다:
    // 뒤 런의 오프셋이 코드 길이만큼 밀리고, 코드 밖의 이모지와 코드 안의 날짜가
    // 한 필드로 이어져 코드까지 통째로 덮인다.
    if (child.isText && !isInlineCode(child)) {
      if (runText === "") runStart = offset;
      runText += child.text ?? "";
    } else {
      flush();
    }
    offset += child.nodeSize;
  });
  flush();
}

/** 인라인 코드 마크가 붙은 텍스트인지 — 그 안의 글자는 정의상 리터럴이다. */
function isInlineCode(node: PMNode): boolean {
  // 이름으로 본다. `MarkSpec`에는 `NodeSpec.code`에 해당하는 필드가 없고,
  // 이 앱의 인라인 코드 마크 이름은 `code`로 고정돼 있다
  // (`src/extensions/marks/code.ts:31`).
  return node.marks.some((mark) => mark.type.name === "code");
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

  out.push(
    Decoration.inline(from, to, { class: `${RAW_CLASS} ${RAW_HIDE_CLASS}` }),
  );
  // 로케일을 key에 넣는다. `WidgetType.eq`는 key가 같으면 새 toDOM을 아예
  // 호출하지 않고 기존 DOM을 그대로 재사용한다(불필요한 문서 전역 리렌더를
  // 막으려는 의도) — 그런데 그 재사용이 로케일 전환에도 그대로 적용되면
  // 문서를 안 건드렸다는 이유로 옛 언어 라벨이 화면에 남는다. key에 로케일을
  // 섞어야 언어가 바뀐 순간에만 실제로 다시 그린다.
  const { locale } = useSettingsStore.getState();
  out.push(
    Decoration.widget(to, () => renderTaskChip(span, overdue), {
      key: `task-chip-${from}-${span.kind}-${locale}`,
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

/** `apply`의 tr meta — 로케일이 바뀌었으니 문서·선택이 그대로여도 다시 그려라. */
const LOCALE_CHANGED_META = "localeChanged";

/**
 * 실제 Plugin을 만든다. `TaskFieldChips`(아래)의 `addProseMirrorPlugins`가
 * 쓰는 것과 **같은** 함수를 테스트가 raw `EditorView`에 직접 꽂을 수 있도록
 * 따로 내보낸다 — Tiptap의 `Editor`를 통하면 `dispatchTransaction`이 이미
 * `view.isDestroyed`를 가드하므로(`@tiptap/core`), destroy 이후 구독이 실제로
 * 끊겼는지를 그 경로로는 검증할 수 없다.
 */
export function createTaskFieldChipsPlugin(): Plugin<TaskFieldChipsState> {
  return new Plugin<TaskFieldChipsState>({
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
      // 로케일 변경(아래 view())은 둘 다 그대로여도 다시 그려야 하므로
      // 그 경우만 별도로 뚫는다.
      apply(tr, value, _oldState, newState) {
        const editingItem = findEditingTaskItem(
          newState.doc,
          newState.selection.from,
        );
        const localeChanged =
          tr.getMeta(taskFieldChipsKey) === LOCALE_CHANGED_META;
        if (
          !tr.docChanged &&
          !localeChanged &&
          editingItem === value.editingItem
        ) {
          return value;
        }
        return nextState(newState.doc, newState.selection.from, editingItem);
      },
    },
    // 데코레이션은 문서·선택 변경에만 다시 만들어진다. 설정에서 언어를
    // 바꾸는 것은 둘 중 어느 것도 아니므로, 이 구독이 없으면 이미 그려진
    // 문서가 옛 언어로 남는다(`vim-lifecycle.ts:55`,
    // `code-block-node-view.ts:224`와 같은 전례).
    view(editorView) {
      const unsubscribe = useSettingsStore.subscribe((state, prev) => {
        if (state.locale === prev.locale) return;
        const tr = editorView.state.tr.setMeta(
          taskFieldChipsKey,
          LOCALE_CHANGED_META,
        );
        editorView.dispatch(tr);
      });
      return {
        destroy() {
          unsubscribe();
        },
      };
    },
  });
}

export const TaskFieldChips = Extension.create({
  name: "taskFieldChips",

  addProseMirrorPlugins() {
    return [createTaskFieldChipsPlugin()];
  },
});
