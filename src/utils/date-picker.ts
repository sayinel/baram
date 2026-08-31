// §308 날짜를 **골라서** 넣는다 — 달력 한 벌.
//
// 왜 필요한가: 슬래시 커맨드가 텍스트 입력만 열면 `due:m `보다 느리다(메뉴를 열고,
// 고르고, 모달에 타이핑한다). `/priority`가 값을 갖는 이유는 `<select>`가 **무엇을 고를 수
// 있는지 보여주기** 때문인데, 날짜에 해당하는 것은 달력이다. 달력이 없으면 `/due`는 이미
// 있는 입력 규칙보다 나은 점이 하나도 없다.
//
// ‼️ `<input type="date">`를 쓰지 않는다. macOS WKWebView에서는 그럴듯하지만 Linux의
// WebKitGTK는 이 타입을 제대로 지원하지 않아, 같은 앱이 플랫폼에 따라 달력이 있고 없고가
// 갈린다. 디자인 토큰도 못 태운다.
//
// ‼️ 텍스트 입력을 없애지 않는다. 달력은 **찾아보는** 도구이고 `+3`·`t`·`9/30`은 **아는
// 사람이 빨리 적는** 길이다. 둘은 같은 값을 가리키는 두 손잡이이므로 서로를 따라간다 —
// 치면 달력이 그 달로 옮겨 가고, 누르면 입력에 ISO가 들어간다.

import type { Locale } from "../i18n";

import { t } from "../i18n";
import { resolveDateInput } from "./tasks/task-date-input";

export interface DateFieldParts {
  /** 달력. 입력 아래에 놓인다. */
  calendar: HTMLElement;
  /** 값을 들고 있는 것은 언제나 이 입력이다 — 달력은 여기에 쓸 뿐이다. */
  input: HTMLInputElement;
}

/**
 * 텍스트 입력 + 달력 한 쌍. 값의 유일한 출처는 입력이다.
 *
 * 달력이 값을 따로 들지 않는 것이 요점이다. 둘이 각자 상태를 가지면 "친 값"과 "누른 값"이
 * 어긋나는 순간이 생기고, 그때 무엇이 저장되는지는 아무도 모른다.
 */
export function buildDateField(
  input: HTMLInputElement,
  today: Date,
  locale: Locale,
): DateFieldParts {
  const calendar = document.createElement("div");
  calendar.className = "date-picker";

  // 보이는 달. 값이 있으면 그 달, 없으면 이번 달에서 시작한다.
  let cursor = startOfMonth(resolved(input.value, today) ?? today);

  const render = (): void => {
    calendar.replaceChildren(
      buildHeader(cursor, locale, (delta) => {
        cursor = addMonths(cursor, delta);
        render();
      }),
      buildWeekdays(locale),
      // ‼️ 표시하는 것은 **해석된** 날이다. 입력에 `+30`이라 적혀 있어도 그것이 가리키는
      // 칸이 물들어야 한다 — 빠른 표기가 어느 날인지 눈으로 확인시키는 것이 이 쌍의
      // 값이고, ISO만 알아보면 아는 사람에게는 달력이 그냥 장식이 된다.
      buildGrid(cursor, resolved(input.value, today), today, (iso) => {
        input.value = iso;
        // 입력이 값의 출처이므로 눌렀을 때도 입력을 거쳐 간다.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }),
    );
  };

  // 치는 동안 달력이 따라간다. 해석되지 않는 값이면 **보던 달에 머문다** — 한 글자
  // 지웠다는 이유로 이번 달로 튀면 고르던 자리를 잃는다.
  input.addEventListener("input", () => {
    cursor = startOfMonth(resolved(input.value, today) ?? cursor);
    render();
  });

  render();
  return { calendar, input };
}

/** 이 날짜가 든 달의 1일. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * 달을 옮긴다. 받는 것은 언제나 `startOfMonth`를 지난 1일이므로 "31일에서 2월로 넘어가면
 * 3월로 튄다"는 함정이 여기서는 생기지 않는다 — 그 불변식이 이 한 줄의 근거다.
 */
function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** 날짜 칸 42개. 6주 고정이라 달을 넘겨도 다이얼로그 높이가 출렁이지 않는다. */
function buildGrid(
  month: Date,
  selected: Date | null,
  today: Date,
  onPick: (iso: string) => void,
): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "date-picker-grid";
  grid.setAttribute("role", "grid");

  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  for (let i = 0; i < 42; i += 1) {
    const day = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    const iso = toIso(day);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "date-picker-day";
    cell.textContent = String(day.getDate());
    cell.dataset.iso = iso;
    if (day.getMonth() !== month.getMonth()) {
      cell.classList.add("date-picker-day-outside");
    }
    if (selected && iso === toIso(selected)) {
      cell.classList.add("date-picker-day-selected");
      cell.setAttribute("aria-current", "date");
    }
    if (iso === toIso(today)) cell.classList.add("date-picker-day-today");
    cell.addEventListener("click", () => onPick(iso));
    grid.appendChild(cell);
  }

  // ‼️ 방향키로 옮긴다. 칸이 42개라 Tab으로 훑게 두면 달력 하나를 지나는 데 Tab을
  // 42번 눌러야 하고, 그 사이 확인 버튼에 닿을 수 없다.
  grid.addEventListener("keydown", (event) => {
    const step = ARROW_STEPS[event.key];
    if (step === undefined) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !grid.contains(focused)) return;
    const cells = [...grid.querySelectorAll<HTMLElement>(".date-picker-day")];
    const at = cells.indexOf(focused);
    const next = cells[at + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  });

  return grid;
}

/** `‹ 2026년 9월 ›`. 달 이름은 OS의 것을 쓴다 — 12개를 두 언어로 다시 적지 않는다. */
function buildHeader(
  month: Date,
  locale: Locale,
  onMove: (delta: number) => void,
): HTMLElement {
  const header = document.createElement("div");
  header.className = "date-picker-header";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "date-picker-nav";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", t("datePicker.prevMonth", locale));
  prev.addEventListener("click", () => onMove(-1));

  const label = document.createElement("span");
  label.className = "date-picker-month";
  label.textContent = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
  }).format(month);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "date-picker-nav";
  next.textContent = "›";
  next.setAttribute("aria-label", t("datePicker.nextMonth", locale));
  next.addEventListener("click", () => onMove(1));

  header.append(prev, label, next);
  return header;
}

/** 요일 머리글. 첫 글자만 — 칸이 좁다. */
function buildWeekdays(locale: Locale): HTMLElement {
  const row = document.createElement("div");
  row.className = "date-picker-weekdays";
  const format = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "narrow",
  });
  // 1970-01-04는 일요일. 요일 이름을 얻으려는 것뿐이라 어느 주든 상관없다.
  for (let i = 0; i < 7; i += 1) {
    const cell = document.createElement("span");
    cell.textContent = format.format(new Date(1970, 0, 4 + i));
    row.appendChild(cell);
  }
  return row;
}

function intlLocale(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : "en-US";
}

/**
 * 입력이 가리키는 날. 어휘는 `resolveDateInput` 한 자가 안다 — ISO·`t`·`m`·`+N`·`M/D`가
 * 전부 여기서 같은 날을 뜻하고, 달력이 그 어휘를 따로 알 이유가 없다.
 */
function resolved(value: string, today: Date): Date | null {
  const iso = resolveDateInput(value, today);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 방향키가 옮기는 칸 수. 위아래가 한 주다. */
const ARROW_STEPS: Record<string, number | undefined> = {
  ArrowDown: 7,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
};
