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
import { formatTimer, parseTimer } from "../../utils/tasks/task-timer";
import { CHIP_KIND_ATTR, CHIP_VALUE_ATTR } from "./task-chip-edit";

/** 날짜 필드 종류 → i18n 키. 우선순위와 반복은 값이 날짜가 아니라 따로 간다. */
const DATE_CHIP_KEY: Record<
  Exclude<TaskFieldKind, "priority" | "recurrence" | "timer">,
  string
> = {
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
  today: Date,
): HTMLElement {
  const el = document.createElement("span");
  el.className = "task-chip";
  // 색을 갖는 상태는 기한 초과 하나뿐이다(방향 C, §308) — 점과 글자 모두
  // `.task-chip-overdue`의 currentColor를 탄다(tasks.css).
  if (overdue) el.classList.add("task-chip-overdue");
  el.contentEditable = "false";
  // §308 M3-a 이 칩은 누를 수 있는 조작이다. 그래서 **`aria-hidden`을 벗었다** —
  // 감춰 두면 보조기술에서 도달할 방법이 없는 버튼이 된다. 정보가 두 번 읽히지 않도록
  // 그 표식은 원문 쪽(`.task-field-raw`)으로 옮겼다: 조작이 있는 쪽이 트리에 남는다.
  //
  // `data-vim-suspend`는 붙이지 않는다. 피커가 에디터 밖 모달이라 키가 `view.dom`에
  // 도달하지 않고(§298 규약의 portal 예외), 칩 자체는 여전히 키를 소유하지 않는다.
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  // ‼️ 정체는 **위치가 아니라 이것**으로 말한다. 위치를 DOM에 구우면 문서가 바뀌는 순간
  // 낡고, 그 낡은 값으로 쓰면 엉뚱한 글자를 덮는다.
  el.setAttribute(CHIP_KIND_ATTR, span.kind);
  el.setAttribute(CHIP_VALUE_ATTR, span.value);
  const label = chipLabel(span, locale, today);
  el.setAttribute("aria-label", label);
  el.append(document.createTextNode(label));
  return el;
}

/**
 * 칩에 보일 라벨. 이모지를 그대로 보이는 대신 로케일별 어순의 텍스트로
 * 읽는다(방향 C — ko `8/30 기한`, en `due 8/30`).
 */
function chipLabel(span: TaskFieldSpan, locale: Locale, today: Date): string {
  // §18.18 M4 — 반복은 셋째 갈래다. 값이 날짜가 아니라 사용자가 적은 자유 텍스트
  // ("every week")라 `shortDate`에 넣을 수 없고, 번역할 수도 없다. 라벨은 그 텍스트를
  // 그대로 감싸기만 한다 — 어순만 로케일이 정한다.
  if (span.kind === "recurrence") {
    return t("tasks.chip.recurrence", locale, { rule: span.value });
  }
  if (span.kind === "timer") return timerLabel(span.value, locale);
  if (span.kind === "priority") {
    // 마커 자체(span.value)로 매핑한다 — UTF-16 길이로 자르지 않는다.
    const key = PRIORITY_CHIP_KEY[span.value];
    // `""`는 도달 불가다(`scanTaskFields`가 `if (!marker) continue`로 빈 마커를
    // 거르고 `PRIORITY_CHIP_KEY`가 나머지 넷을 정확히 덮는다). 방어로 남긴다.
    return key ? t(`tasks.chip.priority.${key}`, locale) : "";
  }
  return t(DATE_CHIP_KEY[span.kind], locale, {
    date: shortDate(span.value, today),
  });
}

/**
 * `2026-08-30` → `8/30`. 올해가 아니면 연도를 붙인다 → `2027/8/25`.
 *
 * ‼️ 연도를 늘 접었더니 **날짜가 거짓말을 했다.** `📅2027-08-25`가 `8/25 기한`으로 보여
 * 사용자가 그것을 기한 초과로 읽었고, 아젠다가 "나중"에 넣은 것을 버킷 분류의 결함으로
 * 의심했다 — 화면이 감춘 바로 그 한 조각이 어느 버킷인지를 정하는 값이었다.
 *
 * 기준일을 인자로 받는 것도 그래서다. 기한 초과 색과 연도 표시가 **같은 시계**를 봐야
 * "빨간데 연도가 없다"와 "연도가 있는데 색이 없다"가 서로를 배반하지 않는다.
 */
function shortDate(iso: string, today: Date): string {
  const [year, month, day] = iso.split("-");
  const md = `${Number(month)}/${Number(day)}`;
  return Number(year) === today.getFullYear() ? md : `${year}/${md}`;
}

/**
 * §18.18 M4 시간 기록의 라벨.
 *
 * ‼️ **돌고 있을 때는 숫자를 보이지 않는다.** 칩은 문서나 선택이 바뀔 때만 다시 그려지므로
 * 경과 시간을 적으면 그 숫자가 그 자리에서 얼어붙는다 — 세 시간 뒤에도 "1h27m 기록 중"이라
 * 적혀 있으면 그것은 표시가 아니라 거짓말이다. 대신 **언제부터**인지를 보인다: 시각은 늙지
 * 않는다. 총합은 멈춘 뒤에 보면 된다.
 */
function timerLabel(value: string, locale: Locale): string {
  const timer = parseTimer(value);
  // 읽지 못하는 값은 적힌 그대로 보인다 — 우리가 못 읽는다고 사용자 글자를 숨기지 않는다.
  if (timer === null) return value;
  if (timer.startedAt !== null) {
    return t("tasks.chip.timerRunning", locale, {
      time: timer.startedAt.slice(11),
    });
  }
  return t("tasks.chip.timer", locale, { duration: formatTimer(timer) });
}
