// §308 표시 계층 — 필드 하나를 **뭐라고 쓸 것인가**.
//
// `task-field-chips.ts`에서 떼어냈다. 그쪽의 관심사는 "문서 어디에 무엇이
// 있는가"(순회 · 허용 목록 · 스캔 · 플러그인 배선)이고, 여기의 관심사는 "그것을
// 뭐라고 쓸 것인가"(표기 · 언어)다. 방향 A(이모지 알약)에서 C(점 + 텍스트)로
// 넘어올 때 바뀐 것이 **정확히 이 절반뿐**이었다는 사실이 이 경계가 인위적이지
// 않다는 증거다.
//
// 로케일은 **인자로 받는다** — 여기서 store를 읽지 않는 것이 요점이다.
// `buildTaskFieldDecorations`가 진입점에서 한 번 읽어 아래로 넘기므로 문서 전체
// 순회에서 필드 수만큼 `getState()`를 되풀이하지 않고, "라벨의 언어는 데코레이션을
// 만든 그 시점에 고정된다"는 사실이 시그니처에 드러난다. 위젯 key에 로케일을
// 섞는 일은 저쪽에 남는다 — 그건 표기가 아니라 캐시 무효화다.

import type { Locale } from "../../i18n";
import type {
  TaskFieldKind,
  TaskFieldSpan,
} from "../../utils/tasks/task-field-scan";

import { t } from "../../i18n";
import { PRIORITY_EMOJI } from "../../utils/tasks/task-field-tokens";

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
 *
 * `"highest"` 접미사가 가리키는 en/ko 값은 각각 "urgent"/"긴급"이다 — 표시 단어가
 * 이 표 자체와 다르다. 키는 저장 레벨(§ PRIORITY_EMOJI의 "1")을 가리키는 이름이고
 * Obsidian Tasks 호환 규약상 그대로 두기로 했으므로, 다음에 보는 사람이 "고쳐야 할
 * 불일치"로 착각하지 않도록 남긴다.
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
 * 같은 정보의 시각적 중복이다. 따라서 `.task-field-raw`는 원문을 `display:none`으로
 * 지우면 안 된다(그러면 보조기술에서 정보가 통째로 사라진다). 그 짝으로,
 * **칩의 색 대비를 낮춰서도 안 된다** — 원문이 감춰져 있으므로 칩이 이 메타데이터의
 * 유일한 시각 표현이다(`src/styles/tasks.css`의 `.task-chip`).
 */
export function renderTaskChip(
  span: TaskFieldSpan,
  overdue: boolean,
  locale: Locale,
): HTMLElement {
  const el = document.createElement("span");
  el.className = "task-chip";
  // 색을 갖는 상태는 기한 초과 하나뿐이다(방향 C, §308) — 점과 글자 모두
  // `.task-chip-overdue`의 currentColor를 탄다(tasks.css).
  if (overdue) el.classList.add("task-chip-overdue");
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.append(document.createTextNode(chipLabel(span, locale)));
  return el;
}

/**
 * 칩에 보일 라벨. 이모지를 그대로 보이는 대신 로케일별 어순의 텍스트로
 * 읽는다(방향 C — ko `8/30 기한`, en `due 8/30`).
 */
function chipLabel(span: TaskFieldSpan, locale: Locale): string {
  if (span.kind === "priority") {
    // 마커 자체(span.value)로 매핑한다 — UTF-16 길이로 자르지 않는다.
    const key = PRIORITY_CHIP_KEY[span.value];
    // `""`는 도달 불가다(`scanTaskFields`가 `if (!marker) continue`로 빈 마커를
    // 거르고 `PRIORITY_CHIP_KEY`가 나머지 넷을 정확히 덮는다). 방어로 남긴다.
    return key ? t(`tasks.chip.priority.${key}`, locale) : "";
  }
  return t(DATE_CHIP_KEY[span.kind], locale, { date: shortDate(span.value) });
}

/** `2026-08-30` → `8/30`. 연도는 접는다 — 줄이 길어지고 대개 같은 해다. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}
