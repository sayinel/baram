// §308 상호작용 절반 — 칩을 눌러 값을 고친다.
//
// M2-e가 넘긴 제약 셋이 이 파일의 모양을 전부 결정한다(§18.11):
//
// 1. 칩은 NodeView가 아니라 `Decoration.widget`이고, **커서가 그 태스크 줄에 들어가면
//    데코레이션이 통째로 사라진다.** 그래서 클릭이 캐럿을 옮기면 누른 그 칩이 그 순간
//    없어진다 — `mousedown`에서 `preventDefault()`가 선택이 아니라 요건이다.
// 2. 피커가 값을 확정할 때 위젯 DOM은 이미 사라졌을 수 있다. **위젯 참조에 기대지 않고**
//    문단 위치를 캡처해 트랜잭션을 만든다.
// 3. 그래서 피커는 칩에 붙은 팝오버가 아니라 **모달**이다. 앵커가 살아 있을 필요가 없다.
//
// 그리고 이 코드베이스의 규율 하나: 모달이 열려 있는 동안 그 줄이 바뀔 수 있으므로
// **캡처한 문단 텍스트를 확정 시 다시 대조한다.** 디스크 쓰기의 `expected_raw`와 같은
// 계약이다 — 위치만 믿으면 엉뚱한 글자를 덮는다.
import type { Locale } from "../../i18n";
import type { TaskFieldKind } from "../../utils/tasks/task-field-scan";
import type { EditorView } from "@tiptap/pm/view";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { showFieldDialog } from "../../utils/field-dialog";
import { resolveDateInput } from "../../utils/tasks/task-date-input";
import { scanTaskFields } from "../../utils/tasks/task-field-scan";
import { PRIORITY_EMOJI } from "../../utils/tasks/task-field-tokens";

/** 칩 DOM이 자기 정체를 말하는 두 속성 — **위치가 아니다**(위치는 곧 낡는다). */
export const CHIP_KIND_ATTR = "data-chip-kind";
export const CHIP_VALUE_ATTR = "data-chip-value";

/** 우선순위 선택지 — 저장 레벨 문자열이 값이다. "3"(보통)은 마커가 없어 빈 값이다. */
const PRIORITY_LEVELS = ["1", "2", "3", "4", "5"] as const;

interface ChipEditTarget {
  kind: TaskFieldKind;
  /** 문단 **내용**의 시작 위치. 스팬 오프셋을 그대로 더하는 기준이다. */
  paragraphFrom: number;
  /** 낙관적 잠금 — 확정 시 다시 읽어 같아야 한다. */
  paragraphText: string;
  /** 누른 그 칩의 값. 같은 종류가 두 개면 이것이 가른다. */
  value: string;
}

/**
 * 칩 클릭. 처리했으면 `true` — ProseMirror가 그 위에 자기 선택 처리를 얹지 않는다.
 *
 * 비동기 부분(모달)은 의도적으로 기다리지 않는다. `handleDOMEvents`는 동기 boolean을
 * 요구하고, 모달이 닫힐 때까지 이벤트 처리를 붙잡고 있을 이유도 없다.
 */
export function handleChipMouseDown(
  view: EditorView,
  event: MouseEvent,
): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const chip = target.closest<HTMLElement>(".task-chip");
  if (!chip || !view.dom.contains(chip)) return false;

  const kind = chip.getAttribute(CHIP_KIND_ATTR) as null | TaskFieldKind;
  const value = chip.getAttribute(CHIP_VALUE_ATTR);
  if (kind === null || value === null) return false;

  // ‼️ 캐럿을 옮기지 않는다. 옮기면 이 줄의 데코레이션이 사라져 칩이 그 자리에서
  // 없어지고, 사용자는 "눌렀더니 사라졌다"를 겪는다.
  event.preventDefault();

  const found = captureParagraph(view, chip);
  if (!found) return true;

  void openPicker(view, { ...found, kind, value });
  return true;
}

/** 칩이 붙은 문단의 위치와 원문. 못 찾으면 `null`. */
function captureParagraph(
  view: EditorView,
  chip: HTMLElement,
): null | { paragraphFrom: number; paragraphText: string } {
  let pos: number;
  try {
    pos = view.posAtDOM(chip, 0);
  } catch {
    // 위젯 DOM이 방금 교체됐으면 위치를 못 준다 — 조용히 포기한다(다음 클릭은 된다).
    return null;
  }
  const $pos = view.state.doc.resolve(
    Math.max(0, Math.min(pos, view.state.doc.content.size)),
  );
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "paragraph") {
      return { paragraphFrom: $pos.start(d), paragraphText: node.textContent };
    }
  }
  return null;
}

/** 모달을 열고, 값이 나오면 트랜잭션을 만든다. */
async function openPicker(
  view: EditorView,
  target: ChipEditTarget,
): Promise<void> {
  const locale = useSettingsStore.getState().locale as Locale;
  const next =
    target.kind === "priority"
      ? await askPriority(target.value, locale)
      : await askDate(target, locale);
  if (next === null) return;
  commit(view, target, next);
}

/** 우선순위 마커를 고른다. 돌려주는 것은 **마커**(빈 문자열 = 보통 = 제거). */
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

/** 날짜를 고친다. 돌려주는 것은 **ISO 날짜**(빈 문자열 = 필드 제거). */
async function askDate(
  target: ChipEditTarget,
  locale: Locale,
): Promise<null | string> {
  const values = await showFieldDialog({
    fields: [
      {
        key: "date",
        // 받아들이는 표기를 라벨이 직접 말한다 — `resolveDateInput`이 아는 어휘다.
        label: t("tasks.triage.pickLabel", locale),
        placeholder: "2026-08-30",
        value: target.value,
      },
    ],
    submitLabel: t("tasks.chip.edit.submit", locale),
    title: t(`tasks.chip.edit.${target.kind}`, locale),
  });
  if (values === null) return null;

  const raw = (values.date ?? "").trim();
  // 비운 것은 "이 필드를 지운다"는 뜻이다 — `setTaskField`의 계약과 같다.
  if (raw === "") return "";

  const iso = resolveDateInput(raw, new Date());
  if (iso === null) {
    useUIStore
      .getState()
      .showToast(t("tasks.triage.badDate", locale, { value: raw }), "error");
    return null;
  }
  return iso;
}

/**
 * 확정. 캡처한 문단이 그대로일 때만 쓴다.
 *
 * 값만 갈아끼우므로 §303 canonical 순서는 흔들리지 않는다 — 필드를 옮기지도, 더하지도
 * 않는다. 제거할 때만 앞의 공백을 함께 가져간다.
 */
function commit(view: EditorView, target: ChipEditTarget, next: string): void {
  const locale = useSettingsStore.getState().locale as Locale;
  const { doc } = view.state;
  const from = target.paragraphFrom;
  if (from < 0 || from > doc.content.size) return;

  const $from = doc.resolve(from);
  const paragraph = $from.parent;
  // ‼️ 낙관적 잠금. 모달이 열려 있는 동안 그 줄이 바뀌었으면 아무것도 쓰지 않는다 —
  // 위치만 믿고 쓰면 사용자가 그 사이에 친 글자를 덮는다.
  if (
    paragraph.type.name !== "paragraph" ||
    paragraph.textContent !== target.paragraphText
  ) {
    useUIStore
      .getState()
      .showToast(t("tasks.chip.edit.stale", locale), "error");
    return;
  }

  // 종류만으로 고르면 언제나 첫 번째가 바뀐다 — 두 번째 칩을 눌러도 첫 번째가 고쳐진다.
  // 값까지 보면 한 줄에 같은 필드가 둘 있어도 누른 그것이 잡힌다.
  //
  // 남는 구멍 하나: 같은 종류에 **같은 값**이 두 번 있으면(`📅2026-08-30`이 한 줄에
  // 둘) 첫 번째가 잡힌다. 둘이 구별되지 않으므로 결과 문자열은 같고, 사용자가 볼 수
  // 있는 차이는 나머지 하나가 안 바뀌었다는 것뿐이다. 위치까지 들고 다니면 막을 수
  // 있으나 그 위치는 곧 낡는 값이라, 드문 경우를 위해 낡을 수 있는 상태를 들이지 않는다.
  const span = scanTaskFields(target.paragraphText).find(
    (s) => s.kind === target.kind && s.value === target.value,
  );
  if (!span) return;

  if (next === "") {
    // 앞의 공백까지 — 남기면 `할 일  ⏫`처럼 두 칸이 된다.
    view.dispatch(
      view.state.tr.delete(from + Math.max(0, span.from - 1), from + span.to),
    );
    return;
  }

  // 날짜 스팬은 이모지와 값 **사이의 공백까지** 덮는다(`scanTaskFields`). 그래서 여기서
  // 다시 쓰면 `📅 2026-08-30`이 canonical한 `📅2026-08-30`으로 정규화된다 — §303이
  // 정한 형태이고, 쓰기 경로(Rust `write.rs`)도 같은 형태로 쓴다.
  const replacement =
    target.kind === "priority" ? next : `${span.emoji}${next}`;
  view.dispatch(
    view.state.tr.insertText(replacement, from + span.from, from + span.to),
  );
}
