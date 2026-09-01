import type { TaskFieldSpan } from "../task-field-scan";

import { describe, expect, it } from "vitest";

import { scanTaskFields } from "../task-field-scan";

describe("scanTaskFields", () => {
  it("기한 필드의 구간과 값을 찾는다", () => {
    const t = "보고서 초안 📅2026-08-30";
    const [f] = scanTaskFields(t);
    expect(f).toMatchObject({ kind: "due", value: "2026-08-30" });
    expect(t.slice(f.from, f.to)).toBe("📅2026-08-30");
  });

  it("세 날짜 필드를 등장 순서대로 돌려준다", () => {
    const spans = scanTaskFields("초안 🛫2026-08-25 ⏳2026-08-27 📅2026-08-30");
    expect(spans.map((s) => s.kind)).toEqual(["start", "scheduled", "due"]);
  });

  it("우선순위 마커를 찾는다", () => {
    const t = "초안 ⏫";
    const [f] = scanTaskFields(t);
    expect(f).toMatchObject({ kind: "priority", value: "⏫" });
    expect(t.slice(f.from, f.to)).toBe("⏫");
  });

  it("날짜가 뒤따르지 않는 이모지는 구간이 아니다", () => {
    // 본문에 장식으로 쓴 이모지를 삼키면 사용자 글자가 화면에서 사라진다.
    expect(scanTaskFields("오늘 📅 회의 잡기")).toEqual([]);
  });

  it("달력에 없는 날짜는 구간이 아니다", () => {
    expect(scanTaskFields("초안 📅2026-13-99")).toEqual([]);
  });

  it("같은 이모지가 여러 번이면 전부 돌려준다", () => {
    const spans = scanTaskFields("초안 📅2026-08-01 📅2026-08-30");
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.value)).toEqual(["2026-08-01", "2026-08-30"]);
  });

  it("이모지 앞의 한글이 UTF-16 인덱스에 반영된다", () => {
    // 서로게이트 쌍을 코드포인트로 세면 여기서 어긋난다.
    const t = "보고서 초안 📅2026-08-30";
    const [f] = scanTaskFields(t);
    expect(f.from).toBe(t.indexOf("📅"));
  });

  it("이모지와 날짜 사이의 공백을 포함한다", () => {
    const t = "초안 📅 2026-08-30";
    const [f] = scanTaskFields(t);
    expect(t.slice(f.from, f.to)).toBe("📅 2026-08-30");
  });

  it("빈 문자열과 필드 없는 줄은 빈 배열", () => {
    expect(scanTaskFields("")).toEqual([]);
    expect(scanTaskFields("그냥 할 일")).toEqual([]);
  });
});

// §18.18 M4 — 반복은 값의 끝을 잴 규칙이 없는 유일한 필드다. 그래서 이 스위트는
// "무엇이 값인가"를 Rust 인덱서(`task/parse.rs`의 `parse_task_line`)와 **한 글자씩
// 맞춘다**: 저쪽이 날짜·우선순위를 먼저 떼어내고 남은 것을 반복으로 읽으므로,
// 여기서 줄 끝까지를 통째로 삼키면 화면과 아젠다가 같은 줄을 다르게 말한다.
describe("scanTaskFields — 반복(🔁)", () => {
  it("자유 텍스트 값을 구간으로 잡는다", () => {
    const t = "주간 회고 🔁every week";
    const [f] = scanTaskFields(t);
    expect(f).toMatchObject({ kind: "recurrence", value: "every week" });
    expect(t.slice(f.from, f.to)).toBe("🔁every week");
  });

  it("이모지와 값 사이의 공백을 허용한다", () => {
    expect(scanTaskFields("회고 🔁 every 2 days")[0]).toMatchObject({
      kind: "recurrence",
      value: "every 2 days",
    });
  });

  // ‼️ 이것이 이 스위트의 요점이다. Rust는 📅를 **먼저** 뽑아 `due`로 읽고 남은
  // `every week`를 반복으로 읽는다. 줄 끝까지를 반복으로 삼으면 기한 칩이 화면에서
  // 사라지고, 그 자리를 눌러 고치면 반복 규칙 한가운데를 덮어쓴다.
  it("값은 줄 끝이 아니라 **다음 필드 앞**에서 끝난다", () => {
    const spans = scanTaskFields("회고 🔁every week 📅2026-09-01");
    expect(spans.map((s) => s.kind)).toEqual(["recurrence", "due"]);
    expect(spans[0].value).toBe("every week");
    expect(spans[1].value).toBe("2026-09-01");
  });

  it("값이 없는 맨 🔁는 구간이 아니다 — 인덱서도 `None`으로 둔다", () => {
    // 장식으로 적은 이모지를 삼키면 사용자 글자가 화면에서 사라진다는, 날짜 쪽과
    // 같은 규칙이다. 뒤의 날짜는 그대로 기한으로 남는다.
    const spans = scanTaskFields("주간 회고 🔁 📅2026-08-30");
    expect(spans.map((s) => s.kind)).toEqual(["due"]);
  });

  it("canonical 순서(반복이 맨 뒤)에서는 줄 끝까지가 값이다", () => {
    const spans = scanTaskFields("회고 📅2026-09-01 ⏫ 🔁every week");
    expect(spans.map((s) => s.kind)).toEqual(["due", "priority", "recurrence"]);
    expect(spans[2].value).toBe("every week");
  });
});

// ‼️ 반복 구간의 **끝**. M4가 `to`를 "다음 필드의 시작"으로 뒀는데, 그러면 그 사이의
// 구분 공백이 구간 안에 들어간다. 사용자가 앱에서 먼저 본 것은 셋 중 가장 가벼운 것
// (칩 표시)이었지만, 나머지 둘은 파일을 망가뜨린다 — 이 세 줄이 그 셋을 함께 잡는다.
describe("§303 반복 구간은 값의 끝에서 멈춘다", () => {
  const LINE = "a ➕2026-09-01 🔁every week on Monday 📅2026-09-03";

  function recurrence(text: string): TaskFieldSpan {
    const found = scanTaskFields(text).find((s) => s.kind === "recurrence");
    if (!found) throw new Error(`no recurrence span in ${text}`);
    return found;
  }

  it("뒤따르는 구분 공백을 삼키지 않는다", () => {
    const span = recurrence(LINE);
    expect(LINE.slice(span.from, span.to)).toBe("🔁every week on Monday");
  });

  // 값 **앞**의 공백은 필드의 일부다 — Obsidian Tasks가 `🔁 every week`으로 쓴다.
  it("값 앞의 공백은 구간 안에 남긴다", () => {
    const text = "a 🔁 every week 📅2026-09-03";
    const span = recurrence(text);
    expect(text.slice(span.from, span.to)).toBe("🔁 every week");
    expect(span.value).toBe("every week");
  });

  it("줄 끝에서 끝나는 반복도 그대로다", () => {
    const text = "a 🔁every week";
    expect(text.slice(recurrence(text).to)).toBe("");
  });

  // 뒤에 여러 필드가 와도 첫 번째 앞에서 멈춘다.
  it("다음 필드가 여럿이어도 첫 번째 앞에서 멈춘다", () => {
    const text = "a 🔁every week ⏫ 📅2026-09-03";
    expect(recurrence(text).value).toBe("every week");
  });
});
