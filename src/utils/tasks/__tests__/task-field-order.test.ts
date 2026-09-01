// §303 canonical 필드 순서 — 프런트 절반.
//
// ‼️ 첫 테스트의 세 단정은 Rust `src-tauri/src/task/fields.rs`의
// `canonical_field_order_is_the_section_303_table`에 **같은 문자열로** 있다. 캡처는 줄을
// 프런트에서 짓고 정리는 Rust에서 고치므로, 두 표가 갈리면 같은 vault에 두 가지 순서가
// 섞여 쌓인다. 한쪽만 고치면 다른 쪽이 빨간불이 되도록 표를 통째로 마주 적는다.
import { describe, expect, it } from "vitest";

import {
  CANONICAL_DATE_FIELDS,
  fieldRank,
  orderFields,
  PRIORITY_RANK,
  RECURRENCE_RANK,
  TIMER_RANK,
} from "../task-field-order";
import { DATE_FIELDS } from "../task-field-tokens";

describe("§303 canonical 필드 순서", () => {
  it("§18.2 표의 순서 그 자체 — Rust `fields.rs`와 같은 표", () => {
    expect(CANONICAL_DATE_FIELDS.map((f) => f.emoji).join(" ")).toBe(
      "➕ 🛫 ⏳ 📅 ✅ ❌",
    );
    // 우선순위 · 시간 기록 · 반복은 날짜 뒤, 그 순서로.
    //
    // ‼️ 숫자를 그대로 못박는다. Rust `fields.rs`가 같은 숫자를 들고 있고, 두 쪽이
    // 갈리면 같은 조작이 **어느 표면에서 했느냐에 따라 다른 줄**을 만든다 — 그래서
    // 상수 사이의 관계(`< RECURRENCE_RANK`)가 아니라 값 자체가 계약이다.
    expect(PRIORITY_RANK).toBe(6);
    expect(TIMER_RANK).toBe(7);
    expect(RECURRENCE_RANK).toBe(8);
  });

  // §18.18 M4 — 반복은 값이 줄 끝까지라 **반드시 마지막**이다. 시간 기록이 그 뒤로
  // 가면 Rust 파서가 그것을 반복 규칙의 일부로 읽어(`parse_task_line`), 기록한 시간이
  // 아젠다에서 통째로 사라진다.
  it("시간 기록은 반복 **앞**이다", () => {
    expect(TIMER_RANK).toBeLessThan(RECURRENCE_RANK);
    expect(orderFields(["🔁every week", "⏱1h27m"])).toEqual([
      "⏱1h27m",
      "🔁every week",
    ]);
  });

  it("입력 트리거의 이모지는 전부 canonical 표 안에 있다", () => {
    // 트리거 어휘(`task-field-tokens.ts`)와 순서 어휘가 서로 모르는 이모지를 갖게 되면,
    // 캡처가 만든 필드를 정렬이 "모르는 토큰"으로 보고 줄 끝으로 밀어낸다.
    for (const { emoji } of DATE_FIELDS) {
      expect(CANONICAL_DATE_FIELDS.map((f) => f.emoji)).toContain(emoji);
      expect(fieldRank(emoji)).toBeLessThan(PRIORITY_RANK);
    }
  });

  it("뒤섞인 필드를 §303 한 줄로 정렬한다", () => {
    const shuffled = [
      "🔁every week",
      "⏫",
      "❌2026-01-06",
      "📅2026-01-04",
      "➕2026-01-01",
      "✅2026-01-05",
      "⏳2026-01-03",
      "🛫2026-01-02",
    ];
    expect(orderFields(shuffled).join(" ")).toBe(
      "➕2026-01-01 🛫2026-01-02 ⏳2026-01-03 📅2026-01-04 ✅2026-01-05 ❌2026-01-06 ⏫ 🔁every week",
    );
  });

  it("우선순위 마커 넷이 전부 날짜 뒤 같은 자리를 갖는다", () => {
    // "보통"(0)은 마커가 없으므로 목록에 없다 — Rust `PRIORITY_MARKERS`와 같은 집합.
    for (const marker of ["🔺", "⏫", "🔽", "⏬"]) {
      expect(fieldRank(marker)).toBe(PRIORITY_RANK);
    }
  });

  it("순위가 같으면 들어온 순서를 지킨다", () => {
    // 엔진의 정렬 안정성에 기대지 않는다는 계약. 같은 필드가 두 번 들어오는 것은
    // 정상 입력이 아니지만, 그때도 순서를 뒤집지 않는 편이 진단하기 쉽다.
    expect(orderFields(["📅2026-01-02", "📅2026-01-01"])).toEqual([
      "📅2026-01-02",
      "📅2026-01-01",
    ]);
  });

  it("모르는 토큰은 순서를 주장하지 않고 맨 뒤로 간다", () => {
    // 앞으로 보내면 모르는 글자가 본문과 필드 사이를 비집고 들어간다.
    expect(orderFields(["🌀무엇", "📅2026-01-04", "➕2026-01-01"])).toEqual([
      "➕2026-01-01",
      "📅2026-01-04",
      "🌀무엇",
    ]);
  });

  it("빈 목록은 빈 목록", () => {
    expect(orderFields([])).toEqual([]);
  });
});
