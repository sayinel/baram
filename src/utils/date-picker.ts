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
//
// ‼️ 화면 셋이 한 격자를 공유한다(날 → 달 → 해). 먼 날짜를 `›`만으로 찾게 두면 내년 3월에
// 여섯 번, 재작년에 스무 번을 눌러야 한다. 머리글을 누르면 한 층 넓어지고, 칸을 고르면 한
// 층 좁아진다. 격자·방향키·선택 표시는 세 화면이 **같은 코드**를 쓴다 — 갈라지면 방향키가
// 어느 화면에서만 되는 일이 생긴다.

import type { Locale } from "../i18n";

import { t } from "../i18n";
import { resolveDateInput } from "./tasks/task-date-input";

export interface DateFieldParts {
  /** 달력. 입력 아래에 놓인다. */
  calendar: HTMLElement;
  /** 값을 들고 있는 것은 언제나 이 입력이다 — 달력은 여기에 쓸 뿐이다. */
  input: HTMLInputElement;
}

/** 지금 보고 있는 층. 머리글을 누르면 넓어지고, 칸을 고르면 좁아진다. */
type PickerView = "days" | "months" | "years";

/**
 * 텍스트 입력 + 달력 한 쌍. 값의 유일한 출처는 입력이다.
 *
 * 달력이 값을 따로 들지 않는 것이 요점이다. 둘이 각자 상태를 가지면 "친 값"과 "누른 값"이
 * 어긋나는 순간이 생기고, 그때 무엇이 저장되는지는 아무도 모른다.
 *
 * ‼️ 달·해를 고르는 것은 **보는 자리를 옮기는 일**이지 값을 정하는 일이 아니다. 값이 되는
 * 것은 날을 눌렀을 때뿐이다 — 3월을 골랐다고 3월 1일이 마감이 되면 사용자가 고르지 않은
 * 날짜가 저장된다.
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
  let view: PickerView = "days";

  const go = (next: PickerView): void => {
    view = next;
    render();
  };

  const renderMonths = (selected: Date | null): void => {
    calendar.replaceChildren(
      buildHeader({
        label: format(cursor, locale, { year: "numeric" }),
        locale,
        onMove: (delta) => {
          cursor = new Date(cursor.getFullYear() + delta, cursor.getMonth(), 1);
          render();
        },
        onZoom: () => go("years"),
      }),
      buildGrid({
        cells: monthCells(cursor, selected, today, locale),
        columns: 3,
        onPick: (key) => {
          cursor = new Date(cursor.getFullYear(), Number(key), 1);
          go("days");
        },
      }),
    );
  };

  const renderYears = (selected: Date | null): void => {
    const first = yearPageStart(cursor.getFullYear());
    calendar.replaceChildren(
      buildHeader({
        label: `${first} – ${first + YEAR_PAGE - 1}`,
        locale,
        onMove: (delta) => {
          cursor = new Date(
            cursor.getFullYear() + delta * YEAR_PAGE,
            cursor.getMonth(),
            1,
          );
          render();
        },
        // 해 화면이 가장 넓은 층이라 더 열 곳이 없다.
        onZoom: undefined,
      }),
      buildGrid({
        cells: yearCells(first, selected, today),
        columns: 3,
        onPick: (key) => {
          cursor = new Date(Number(key), cursor.getMonth(), 1);
          go("months");
        },
      }),
    );
  };

  const renderDays = (selected: Date | null): void => {
    calendar.replaceChildren(
      buildHeader({
        label: format(cursor, locale, { month: "long", year: "numeric" }),
        locale,
        onMove: (delta) => {
          cursor = addMonths(cursor, delta);
          render();
        },
        onZoom: () => go("months"),
      }),
      buildWeekdays(locale),
      buildGrid({
        cells: dayCells(cursor, selected, today),
        columns: 7,
        onPick: (iso) => {
          input.value = iso;
          // 입력이 값의 출처이므로 눌렀을 때도 입력을 거쳐 간다.
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
        },
      }),
    );
  };

  const render = (): void => {
    // ‼️ 표시하는 것은 **해석된** 날이다. 입력에 `+30`이라 적혀 있어도 그것이 가리키는
    // 칸이 물들어야 한다 — 빠른 표기가 어느 날인지 눈으로 확인시키는 것이 이 쌍의 값이고,
    // ISO만 알아보면 아는 사람에게는 달력이 그냥 장식이 된다.
    const selected = resolved(input.value, today);
    if (view === "months") renderMonths(selected);
    else if (view === "years") renderYears(selected);
    else renderDays(selected);
  };

  // 치는 동안 달력이 따라간다. 해석되지 않는 값이면 **보던 달에 머문다** — 한 글자
  // 지웠다는 이유로 이번 달로 튀면 고르던 자리를 잃는다.
  input.addEventListener("input", () => {
    cursor = startOfMonth(resolved(input.value, today) ?? cursor);
    // 치기 시작하면 날 화면으로 돌아온다 — 값을 정하는 층은 거기뿐이다.
    view = "days";
    render();
  });

  render();
  return { calendar, input };
}

/** 이 날짜가 든 달의 1일. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** 한 화면에 놓는 칸 하나. 세 층이 같은 모양을 쓴다. */
interface PickerCell {
  /** 이 칸이 가리키는 것 — 날은 ISO, 달은 0-11, 해는 연도. */
  key: string;
  label: string;
  /** 이 층의 것이 아니다(지난달의 날, 이 쪽의 다른 해). 흐리게 둔다. */
  outside?: boolean;
  selected?: boolean;
  today?: boolean;
}

/**
 * 달을 옮긴다. 받는 것은 언제나 `startOfMonth`를 지난 1일이므로 "31일에서 2월로 넘어가면
 * 3월로 튄다"는 함정이 여기서는 생기지 않는다 — 그 불변식이 이 한 줄의 근거다.
 */
function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** 방향키가 옮기는 칸 수. 위아래가 한 줄이므로 열 수만큼이다. */
function arrowStep(key: string, columns: number): number | undefined {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  if (key === "ArrowUp") return -columns;
  if (key === "ArrowDown") return columns;
  return undefined;
}

/**
 * 칸 격자 하나. 세 층이 공유한다.
 *
 * ‼️ 방향키로 옮긴다. 칸이 최대 42개라 Tab으로 훑게 두면 달력 하나를 지나는 데 Tab을
 * 42번 눌러야 하고, 그 사이 확인 버튼에 닿을 수 없다. 걸음은 층마다 다른 열 수만큼이므로
 * 그 값이 인자다.
 */
function buildGrid(spec: {
  cells: PickerCell[];
  columns: number;
  onPick: (key: string) => void;
}): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "date-picker-grid";
  grid.setAttribute("role", "grid");
  grid.style.gridTemplateColumns = `repeat(${spec.columns}, 1fr)`;

  for (const cell of spec.cells) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "date-picker-day";
    el.textContent = cell.label;
    el.dataset.key = cell.key;
    // 날 칸만 `data-iso`를 갖는다 — 이 속성으로 "그 날"을 찾는 곳이 여럿이다.
    if (ISO_RE.test(cell.key)) el.dataset.iso = cell.key;
    if (cell.outside) el.classList.add("date-picker-day-outside");
    if (cell.selected) {
      el.classList.add("date-picker-day-selected");
      el.setAttribute("aria-current", "date");
    }
    if (cell.today) el.classList.add("date-picker-day-today");
    el.addEventListener("click", () => spec.onPick(cell.key));
    grid.appendChild(el);
  }

  grid.addEventListener("keydown", (event) => {
    const step = arrowStep(event.key, spec.columns);
    if (step === undefined) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !grid.contains(focused)) return;
    const cells = [...grid.querySelectorAll<HTMLElement>(".date-picker-day")];
    const next = cells[cells.indexOf(focused) + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  });

  return grid;
}

/**
 * `‹ 2026년 9월 ›`. 셋을 한 덩어리로 **가운데 모은다** — 화살표를 양 끝으로 밀면 눈이
 * 그것을 잡지 못하고, 다음에 무엇을 누를지 매번 찾아야 한다.
 *
 * 가운데 라벨은 **버튼**이다. 누르면 한 층 넓어진다(`onZoom`이 없으면 가장 넓은 층이라
 * 누를 수 없고, 그것이 보여야 한다).
 */
function buildHeader(spec: {
  label: string;
  locale: Locale;
  onMove: (delta: number) => void;
  onZoom: (() => void) | undefined;
}): HTMLElement {
  const header = document.createElement("div");
  header.className = "date-picker-header";

  const nav = (delta: -1 | 1, glyph: string, key: string): HTMLElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-picker-nav";
    button.textContent = glyph;
    button.setAttribute("aria-label", t(key, spec.locale));
    button.addEventListener("click", () => spec.onMove(delta));
    return button;
  };

  const label = document.createElement("button");
  label.type = "button";
  label.className = "date-picker-month";
  label.textContent = spec.label;
  if (spec.onZoom) {
    label.addEventListener("click", spec.onZoom);
    label.setAttribute("aria-label", t("datePicker.zoomOut", spec.locale));
  } else {
    label.disabled = true;
    label.classList.add("date-picker-month-flat");
  }

  header.append(
    nav(-1, "‹", "datePicker.prevMonth"),
    label,
    nav(1, "›", "datePicker.nextMonth"),
  );
  return header;
}

/** 요일 머리글. 첫 글자만 — 칸이 좁다. */
function buildWeekdays(locale: Locale): HTMLElement {
  const row = document.createElement("div");
  row.className = "date-picker-weekdays";
  // 1970-01-04는 일요일. 요일 이름을 얻으려는 것뿐이라 어느 주든 상관없다.
  for (let i = 0; i < 7; i += 1) {
    const cell = document.createElement("span");
    cell.textContent = format(new Date(1970, 0, 4 + i), locale, {
      weekday: "narrow",
    });
    row.appendChild(cell);
  }
  return row;
}

/** 날짜 칸 42개. 6주 고정이라 달을 넘겨도 다이얼로그 높이가 출렁이지 않는다. */
function dayCells(
  month: Date,
  selected: Date | null,
  today: Date,
): PickerCell[] {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    const iso = toIso(day);
    return {
      key: iso,
      label: String(day.getDate()),
      outside: day.getMonth() !== month.getMonth(),
      selected: selected !== null && iso === toIso(selected),
      today: iso === toIso(today),
    };
  });
}

function format(
  d: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(d);
}

function intlLocale(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : "en-US";
}

/** 열두 달. `key`는 0-11이라 `new Date(year, key, 1)`이 그대로 받는다. */
function monthCells(
  cursor: Date,
  selected: Date | null,
  today: Date,
  locale: Locale,
): PickerCell[] {
  const year = cursor.getFullYear();
  return Array.from({ length: 12 }, (_, month) => ({
    key: String(month),
    label: format(new Date(year, month, 1), locale, { month: "short" }),
    selected:
      selected !== null &&
      selected.getFullYear() === year &&
      selected.getMonth() === month,
    today: today.getFullYear() === year && today.getMonth() === month,
  }));
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

/** 해 화면 한 쪽. 열둘씩 끊어 어느 해에서 열어도 같은 쪽이 나온다. */
function yearCells(
  first: number,
  selected: Date | null,
  today: Date,
): PickerCell[] {
  return Array.from({ length: YEAR_PAGE }, (_, i) => {
    const year = first + i;
    return {
      key: String(year),
      label: String(year),
      selected: selected !== null && selected.getFullYear() === year,
      today: year === today.getFullYear(),
    };
  });
}

function yearPageStart(year: number): number {
  return Math.floor(year / YEAR_PAGE) * YEAR_PAGE;
}

/** 날 칸을 가리는 자물쇠. 달(`0`-`11`)·해(`2026`)와 겹치지 않는 유일한 모양이다. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 해 화면의 쪽 크기. 달 화면과 같은 3×4라 격자가 흔들리지 않는다. */
const YEAR_PAGE = 12;
