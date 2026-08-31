// §308 태스크 필드를 **고르고 쓰는** 한 자 — 칩 클릭(M3-a)과 슬래시 커맨드(M3-b)가 함께 쓴다.
//
// 진입점은 둘이지만 그 뒤는 하나여야 한다. 두 벌이 되면 갈라지는 것은 모양이 아니라
// 계약이다: 어떤 표기를 날짜로 받는지, 빈 값이 무슨 뜻인지, 모달이 열린 사이 줄이 바뀌면
// 무엇을 하는지. 사용자는 같은 필드를 두 방법으로 고칠 수 있으니 두 답이 달라선 안 된다.
//
// M2-e가 넘긴 제약 셋이 이 파일의 모양을 결정한다(§18.11):
//
// 1. 칩은 NodeView가 아니라 `Decoration.widget`이고, **커서가 그 태스크 줄에 들어가면
//    데코레이션이 통째로 사라진다.** 그래서 확정 시점에 위젯 DOM은 이미 없을 수 있다.
// 2. 그래서 **위젯 참조가 아니라 문단 위치**를 캡처해 트랜잭션을 만든다.
// 3. 그래서 피커는 칩에 붙은 팝오버가 아니라 **모달**이다. 앵커가 살아 있을 필요가 없다.
//
// 그리고 이 코드베이스의 규율 하나: 모달이 열려 있는 동안 그 줄이 바뀔 수 있으므로
// **캡처한 문단 텍스트를 확정 시 다시 대조한다.** 디스크 쓰기의 `expected_raw`와 같은
// 계약이다 — 위치만 믿으면 엉뚱한 글자를 덮는다.

import type { Locale } from "../../i18n";
import type { TaskFieldKind } from "../../utils/tasks/task-field-order";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { askDateValue } from "../../utils/editor/ask-date";
import { showFieldDialog } from "../../utils/field-dialog";
import { scanTaskFields } from "../../utils/tasks/task-field-scan";
import {
  applyTaskField,
  minimalEdit,
} from "../../utils/tasks/task-field-splice";
import { PRIORITY_EMOJI } from "../../utils/tasks/task-field-tokens";
import { findEditingTaskItem } from "./task-field-chips";
import { withVimExternalEdit } from "./vim/vim-keys";

/**
 * 고칠 태스크 줄. **위치와 그때의 원문**이며, DOM도 노드 참조도 아니다 — 둘 다 모달이
 * 열려 있는 사이에 사라질 수 있다.
 */
export interface TaskLineTarget {
  /** 문단 **내용**의 시작 위치. 필드 오프셋을 그대로 더하는 기준이다. */
  paragraphFrom: number;
  /** 낙관적 잠금 — 확정 시 다시 읽어 같아야 한다. `taskLineText`가 만든 것이다. */
  paragraphText: string;
}

/**
 * 값을 묻는다. 돌려주는 것은 그 필드의 **자기 어휘**다 — 날짜는 ISO, 우선순위는 마커.
 * 빈 문자열은 "이 필드를 지운다", `null`은 "아무것도 하지 않는다"(취소·해석 실패).
 */
export async function askTaskField(
  kind: TaskFieldKind,
  current: string,
): Promise<null | string> {
  const locale = useSettingsStore.getState().locale as Locale;
  return kind === "priority"
    ? askPriority(current, locale)
    : askDate(kind, current, locale);
}

/**
 * 칩이 붙은 문단을 그 DOM으로부터 캡처한다. 못 찾으면 `null`.
 *
 * 위젯 DOM이 방금 교체됐으면 위치를 못 준다 — 조용히 포기한다(다음 클릭은 된다).
 */
export function captureParagraphAt(
  view: EditorView,
  dom: HTMLElement,
): null | TaskLineTarget {
  let pos: number;
  try {
    pos = view.posAtDOM(dom, 0);
  } catch {
    return null;
  }
  const { doc } = view.state;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === "paragraph") {
      return {
        paragraphFrom: $pos.start(depth),
        paragraphText: taskLineText(node),
      };
    }
  }
  return null;
}

/**
 * 캡처한 문단이 그대로일 때만 쓴다. 썼으면 `true`.
 *
 * `matchValue`를 주면 그 값을 가진 구간을 고친다 — 칩 클릭은 한 줄에 같은 종류가 둘일
 * 때 **누른 그것**을 가리켜야 한다. 주지 않으면 그 종류의 첫 구간이고, 없으면 새로 넣는다.
 */
export function commitTaskField(
  view: EditorView,
  target: TaskLineTarget,
  kind: TaskFieldKind,
  next: string,
  matchValue?: string,
): boolean {
  const { doc } = view.state;
  const from = target.paragraphFrom;
  if (from < 0 || from > doc.content.size) return false;

  const paragraph = doc.resolve(from).parent;
  // ‼️ 낙관적 잠금. 모달이 열려 있는 동안 그 줄이 바뀌었으면 아무것도 쓰지 않는다 —
  // 위치만 믿고 쓰면 사용자가 그 사이에 친 글자를 덮는다.
  if (
    paragraph.type.name !== "paragraph" ||
    taskLineText(paragraph) !== target.paragraphText
  ) {
    const locale = useSettingsStore.getState().locale as Locale;
    useUIStore
      .getState()
      .showToast(t("tasks.chip.edit.stale", locale), "error");
    return false;
  }

  // 남는 구멍 하나: 같은 종류에 **같은 값**이 두 번 있으면 첫 번째가 잡힌다. 둘이
  // 구별되지 않으므로 결과 문자열은 같고, 보이는 차이는 나머지 하나가 그대로라는 것뿐이다.
  // 위치까지 들고 다니면 막을 수 있으나 그 위치는 곧 낡는 값이라, 드문 경우를 위해
  // 낡을 수 있는 상태를 들이지 않는다.
  const span =
    matchValue === undefined
      ? undefined
      : scanTaskFields(target.paragraphText).find(
          (s) => s.kind === kind && s.value === matchValue,
        );
  if (matchValue !== undefined && !span) return false;

  const patch = minimalEdit(
    target.paragraphText,
    applyTaskField(target.paragraphText, kind, next, span),
  );
  if (!patch) return false;

  // 이 편집은 인라인 노드를 건드리지 않는다. `applyTaskField`가 바꾸는 것은 필드 뭉치
  // 안쪽과 그 앞의 공백 하나뿐이고, 채움 문자는 공백이 아니라 `cutSpan`도 `trimEnd`도
  // 그것을 넘어가지 못한다 — `task-field-splice.test.ts`가 그 성질을 직접 단정한다.
  const at = from + patch.at;
  const end = at + patch.remove;
  // ‼️ UI 크롬이 만든 트랜잭션임을 표시한다(§12-6). 없으면 vim이 이것을 사용자의 편집으로
  // 읽어 visual 선택을 normal로 접는다 — 툴바·팔레트·NodeView 피커가 모두 다는 표시다.
  const tr = withVimExternalEdit(view.state.tr);
  if (patch.insert === "") {
    tr.delete(at, end);
  } else {
    // ‼️ `tr.insertText`를 쓰지 않는다. 그것은 `to` 위치의 마크를 물려주므로, 굵은
    // 글씨로 끝나는 줄에 필드를 붙이면 필드까지 굵어지고 그대로 파일에 쓰인다
    // (`**급함📅2026-09-15**`). 새로 넣는 필드는 마크를 갖지 않고, 기존 구간을
    // **고치는** 경우에만 그 구간이 걸치고 있던 마크를 그대로 잇는다.
    const marks =
      patch.remove > 0 ? doc.resolve(at).marksAcross(doc.resolve(end)) : null;
    tr.replaceWith(at, end, view.state.schema.text(patch.insert, marks));
  }
  view.dispatch(tr);
  return true;
}

/**
 * 태스크 줄의 텍스트 — **오프셋이 곧 위치**가 되도록 인라인 노드를 자리만큼 채운다.
 *
 * ‼️ `node.textContent`를 쓰면 안 된다. `#tag`·`[[위키링크]]`·`$수식$`은 인라인 **노드**라
 * 글자를 하나도 내놓지 않으면서 위치는 차지한다(`tag-node.ts`가 `atom: true`). 그래서
 * `textContent`로 잰 필드 오프셋에 문단 시작 위치를 그냥 더하면, 태그가 하나 앞에 있는
 * 줄에서 쓰기가 한 칸 앞에 떨어져 **사용자 글자를 먹는다.** `#deep-work`가 붙은 태스크는
 * 이 앱에서 흔한 모양이라 드문 경우도 아니다.
 *
 * 채움 문자는 U+FFFC(OBJECT REPLACEMENT CHARACTER)다. 공백도 이모지도 아니므로 필드
 * 스캐너에게는 그냥 본문 한 글자이고, 그 자리에서 필드 뭉치가 끊긴다 — Rust가 같은 줄에서
 * `#tag`를 만났을 때 하는 것과 같은 판단이다.
 */
export function taskLineText(paragraph: PMNode): string {
  let out = "";
  paragraph.forEach((child) => {
    out += child.isText
      ? (child.text ?? "")
      : INLINE_PLACEHOLDER.repeat(child.nodeSize);
  });
  return out;
}

/** 이 줄에 이미 있는 그 필드의 값. 없으면 빈 문자열 — 다이얼로그가 그대로 초기값으로 쓴다. */
export function currentTaskField(text: string, kind: TaskFieldKind): string {
  return scanTaskFields(text).find((s) => s.kind === kind)?.value ?? "";
}

/**
 * 커서가 든 **태스크 줄**. 태스크 항목 안이 아니거나 첫 문단이 아니면 `null`.
 *
 * ‼️ 첫 문단이어야 한다. `taskItem`의 content는 `paragraph block*`이라 그 아래 문단을
 * 더 적을 수 있는데, Rust 인덱서는 `- [ ]`로 시작하는 **그 한 줄만** 파싱한다
 * (`task/parse.rs`). 두 번째 문단에 날짜를 쓰면 아젠다에서 이 태스크의 마감이 아니고,
 * 칩도 그리지 않는다 — 에디터만 없는 사실을 말하게 된다. (§316 — 자리가 의미를 결정한다.)
 */
export function taskLineTarget(state: EditorState): null | TaskLineTarget {
  const pos = state.selection.from;
  const itemFrom = findEditingTaskItem(state.doc, pos);
  if (itemFrom === -1) return null;
  const item = state.doc.nodeAt(itemFrom);
  const line = item?.firstChild;
  if (line?.type.name !== "paragraph") return null;

  // `itemFrom + 1`이 항목 내용의 시작 = 첫 문단의 위치, `+2`가 그 내용의 시작이다.
  const contentFrom = itemFrom + 2;
  const contentTo = contentFrom + line.content.size;
  if (pos < contentFrom || pos > contentTo) return null;
  return { paragraphFrom: contentFrom, paragraphText: taskLineText(line) };
}

/**
 * 날짜를 묻는다. 돌려주는 것은 **ISO 날짜**(빈 문자열 = 필드 제거).
 *
 * §316 달력·어휘·오류 보고는 `askDateValue` 한 자에 있다 — `@`의 날짜 선택이
 * 같은 것을 쓴다. 여기 남는 것은 태스크 쪽 문구와 "비운 것 = 필드 제거" 계약뿐.
 */
async function askDate(
  kind: TaskFieldKind,
  current: string,
  locale: Locale,
): Promise<null | string> {
  return askDateValue({
    // 비운 것은 "이 필드를 지운다"는 뜻이다 — `setTaskField`의 계약과 같다.
    allowEmpty: true,
    // 받아들이는 표기를 라벨이 직접 말한다 — `resolveDateInput`이 아는 어휘다.
    label: t("tasks.triage.pickLabel", locale),
    submitLabel: t("tasks.chip.edit.submit", locale),
    title: t(`tasks.chip.edit.${kind}`, locale),
    value: current,
  });
}

/** 우선순위를 묻는다. 돌려주는 것은 **마커**(빈 문자열 = 보통 = 제거). */
async function askPriority(
  current: string,
  locale: Locale,
): Promise<null | string> {
  const level =
    PRIORITY_LEVELS.find((l) => PRIORITY_EMOJI[l] === current) ?? "3";
  const values = await showFieldDialog({
    fields: [
      {
        key: "priority",
        label: t("tasks.chip.edit.priority", locale),
        options: PRIORITY_LEVELS.map((l) => ({
          label: t(`tasks.chip.priority.${PRIORITY_LABEL_KEY[l]}`, locale),
          value: l,
        })),
        value: level,
      },
    ],
    submitLabel: t("tasks.chip.edit.submit", locale),
    title: t("tasks.chip.edit.priority", locale),
  });
  if (values === null) return null;
  return PRIORITY_EMOJI[values.priority ?? "3"] ?? "";
}

/** 우선순위 저장 레벨 → 칩 라벨 i18n 접미사. "3"은 마커가 없지만 고를 수는 있어야 한다. */
const PRIORITY_LABEL_KEY: Record<string, string> = {
  "1": "highest",
  "2": "high",
  "3": "normal",
  "4": "low",
  "5": "lowest",
};

/** 우선순위 선택지 — 저장 레벨 문자열이 값이다. "3"(보통)은 마커가 없어 빈 값이다. */
const PRIORITY_LEVELS = ["1", "2", "3", "4", "5"] as const;

/** 인라인 노드가 차지한 자리. 이 글자는 문서에 쓰이지 않는다 — 자리만 센다. */
const INLINE_PLACEHOLDER = "\uFFFC";
