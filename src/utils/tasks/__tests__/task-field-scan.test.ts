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
