// §308 날짜를 골라서 넣는 달력.
//
// 이 달력이 있어야 `/due`가 `due:m ` 보다 나은 점이 생긴다. `/priority`가 `<select>`로
// 값을 **보여주는** 것과 같은 일을 날짜에 해 주는 것이 여기 있는 이유다.
import { beforeEach, describe, expect, it } from "vitest";

import { buildDateField } from "../date-picker";

/** 수요일. 요일 배치를 사람이 검산할 수 있게 고정한다. */
const WED = new Date(2026, 8, 16);

let input: HTMLInputElement;
let calendar: HTMLElement;

function dayFor(iso: string) {
  const el = calendar.querySelector<HTMLElement>(`[data-iso="${iso}"]`);
  if (!el) throw new Error(`${iso} 칸이 없다`);
  return el;
}

function days() {
  return [...calendar.querySelectorAll<HTMLElement>(".date-picker-day")];
}

function month() {
  return calendar.querySelector(".date-picker-month")?.textContent ?? "";
}

function mount(value = "") {
  input = document.createElement("input");
  input.value = value;
  document.body.appendChild(input);
  calendar = buildDateField(input, WED, "en").calendar;
  document.body.appendChild(calendar);
}

/** 사용자가 치는 것 — `input` 이벤트가 달력을 따라오게 한다. */
function type(text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("무엇을 보여주는가", () => {
  it("값이 있으면 그 달로 연다", () => {
    mount("2026-12-25");
    expect(month()).toContain("December");
    expect(dayFor("2026-12-25").className).toContain("selected");
  });

  it("값이 없으면 이번 달로 연다", () => {
    mount();
    expect(month()).toContain("September");
    expect(calendar.querySelector(".date-picker-day-selected")).toBeNull();
  });

  it("오늘을 표시한다 — 고르지 않아도", () => {
    mount("2026-09-30");
    expect(dayFor("2026-09-16").className).toContain("today");
  });

  it("‼️ 언제나 6주다 — 달을 넘겨도 다이얼로그 높이가 출렁이지 않는다", () => {
    mount("2026-02-01"); // 4주에 딱 떨어지는 달
    expect(days()).toHaveLength(42);
    mount("2026-08-01"); // 6주가 필요한 달
    expect(days()).toHaveLength(42);
  });

  it("이 달이 아닌 날도 고를 수 있다 — 월말·월초 마감을 위해", () => {
    mount("2026-09-01");
    const prev = dayFor("2026-08-31");
    expect(prev.className).toContain("outside");
    prev.click();
    expect(input.value).toBe("2026-08-31");
  });
});

describe("‼️ 값의 출처는 언제나 입력이다", () => {
  it("날을 누르면 입력에 ISO가 들어간다", () => {
    mount();
    dayFor("2026-09-20").click();
    expect(input.value).toBe("2026-09-20");
  });

  it("누르면 입력 이벤트가 나간다 — 다이얼로그가 값을 걷는 길이 하나다", () => {
    mount();
    let fired = 0;
    input.addEventListener("input", () => (fired += 1));
    dayFor("2026-09-20").click();
    expect(fired).toBe(1);
  });

  it("고른 날이 표시로 남는다", () => {
    mount();
    dayFor("2026-09-20").click();
    expect(dayFor("2026-09-20").className).toContain("selected");
  });
});

describe("‼️ 치면 달력이 따라온다", () => {
  it("`+3`이 어느 날인지 달력이 보여준다", () => {
    // 이 쌍의 값이 여기 있다 — 빠른 표기를 아는 사람도 결과를 **눈으로** 확인한다.
    mount();
    type("+30");
    expect(month()).toContain("October");
    expect(dayFor("2026-10-16").className).toContain("selected");
  });

  it("절대 날짜도 마찬가지다", () => {
    mount();
    type("2027-01-05");
    expect(month()).toContain("January");
    expect(month()).toContain("2027");
  });

  it("해석할 수 없는 값이면 보던 달에 머문다", () => {
    // 한 글자 지웠다는 이유로 달력이 이번 달로 튀면 고르던 자리를 잃는다.
    mount("2026-12-25");
    type("2026-12-2");
    expect(month()).toContain("December");
  });
});

describe("달 넘기기", () => {
  it("앞뒤로 옮긴다", () => {
    mount("2026-09-16");
    calendar.querySelectorAll<HTMLElement>(".date-picker-nav")[1].click();
    expect(month()).toContain("October");
    calendar.querySelectorAll<HTMLElement>(".date-picker-nav")[0].click();
    calendar.querySelectorAll<HTMLElement>(".date-picker-nav")[0].click();
    expect(month()).toContain("August");
  });

  it("‼️ 달을 넘겨도 입력값은 그대로다 — 보는 것과 고른 것은 다르다", () => {
    mount("2026-09-16");
    calendar.querySelectorAll<HTMLElement>(".date-picker-nav")[1].click();
    expect(input.value).toBe("2026-09-16");
  });

  it("31일짜리 달에서 넘겨도 다음 달이다", () => {
    mount("2026-08-31");
    calendar.querySelectorAll<HTMLElement>(".date-picker-nav")[1].click();
    expect(month()).toContain("September");
  });
});

describe("‼️ 방향키로 옮긴다", () => {
  it("좌우는 하루, 위아래는 한 주", () => {
    // 칸이 42개라 Tab으로 훑게 두면 달력 하나를 지나는 데 Tab을 42번 눌러야 하고,
    // 그 사이 확인 버튼에 닿을 수 없다.
    mount("2026-09-16");
    const start = dayFor("2026-09-16");
    start.focus();

    const press = (key: string) =>
      calendar.querySelector(".date-picker-grid")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        }),
      );

    press("ArrowRight");
    expect((document.activeElement as HTMLElement).dataset.iso).toBe(
      "2026-09-17",
    );
    press("ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.iso).toBe(
      "2026-09-24",
    );
    press("ArrowLeft");
    expect((document.activeElement as HTMLElement).dataset.iso).toBe(
      "2026-09-23",
    );
    press("ArrowUp");
    expect((document.activeElement as HTMLElement).dataset.iso).toBe(
      "2026-09-16",
    );
  });

  it("‼️ 격자 밖으로는 나가지 않는다 — 반대쪽으로 감기지도 않는다", () => {
    // 마지막 칸에서 눌러야 갈린다. 첫 칸에서 위로 누르면 "제자리"와 "첫 칸으로 감김"이
    // 같은 결과라 아무것도 구별하지 못한다.
    mount("2026-09-16");
    const last = days()[41];
    last.focus();
    calendar
      .querySelector(".date-picker-grid")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    expect((document.activeElement as HTMLElement).dataset.iso).toBe(
      last.dataset.iso,
    );
  });
});

describe("요일 머리글", () => {
  it("일곱 칸이고 일요일부터다", () => {
    mount();
    const heads = [
      ...calendar.querySelectorAll(".date-picker-weekdays span"),
    ].map((el) => el.textContent);
    expect(heads).toHaveLength(7);
    // 격자의 첫 칸이 일요일이어야 머리글과 줄이 맞는다.
    expect(new Date(days()[0].dataset.iso + "T00:00:00").getDay()).toBe(0);
  });

  it("언어를 탄다", () => {
    const el = document.createElement("input");
    const ko = buildDateField(el, WED, "ko").calendar;
    expect(ko.querySelector(".date-picker-month")?.textContent).toContain(
      "9월",
    );
  });
});
