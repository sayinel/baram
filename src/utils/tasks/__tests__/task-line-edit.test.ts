// M2-b4 태스크 줄 ↔ 폼 값.
//
// 가장 중요한 성질은 **아무것도 고치지 않고 저장했을 때 줄이 그대로**인 것이다.
// 여기가 깨지면 모달은 "열어 보기만 해도 문서가 바뀌는" 도구가 되고, 미리보기로도
// 가려지지 않는다 — 사용자는 바뀐 줄을 자기가 바꾼 것으로 읽는다.
import { describe, expect, it } from "vitest";

import { readTaskLine, writeTaskLine } from "../task-line-edit";

/** 읽었다 그대로 쓰면 원본이어야 한다. */
function roundtrip(line: string): string {
  return writeTaskLine(readTaskLine(line));
}

describe("readTaskLine / writeTaskLine 라운드트립", () => {
  it.each([
    "초안 쓰기",
    "초안 쓰기 📅2026-08-30",
    "초안 쓰기 ➕2026-08-01 🛫2026-08-25 ⏳2026-08-27 📅2026-08-30",
    "초안 쓰기 📅2026-08-30 ⏫",
    "초안 쓰기 #deep-work 📅2026-08-30",
    "초안 쓰기 #deep-work #someday ➕2026-08-01 ⏬",
    "[[202607051530]] 흐름제어 절 📅2026-08-30 🔺",
    "끝난 것 ✅2026-08-22",
    "취소한 것 ❌2026-08-22",
  ])("그대로 돌아온다: %s", (line) => {
    expect(roundtrip(line)).toBe(line);
  });

  it("canonical 순서가 어긋난 줄은 바로잡아 돌려준다", () => {
    // 다른 도구가 만든 줄이 들어올 수 있다. 읽을 때 순서를 주장하지 않으면
    // 저장할 때마다 자리가 흔들려 git diff가 매번 생긴다.
    expect(roundtrip("초안 ⏫ 📅2026-08-30 ➕2026-08-01")).toBe(
      "초안 ➕2026-08-01 📅2026-08-30 ⏫",
    );
  });
});

describe("readTaskLine", () => {
  it("본문·태그·날짜·우선순위를 갈라 담는다", () => {
    const d = readTaskLine("초안 쓰기 #deep-work 📅2026-08-30 ⏫");
    expect(d.body).toBe("초안 쓰기");
    expect(d.tags).toEqual(["deep-work"]);
    expect(d.dates.due).toBe("2026-08-30");
    expect(d.priority).toBe(1);
  });

  it("우선순위는 **가중치**로 읽는다 — 입력 트리거의 순번이 아니다", () => {
    // 🔺는 `prio:1`로 치지만 가중치는 +2다. 두 축을 섞으면 `prio:4`(낮음)가 가중치
    // 4로 읽혀 "가장 높음"보다 위에 선다.
    expect(readTaskLine("x 🔺").priority).toBe(2);
    expect(readTaskLine("x ⏫").priority).toBe(1);
    expect(readTaskLine("x 🔽").priority).toBe(-1);
    expect(readTaskLine("x ⏬").priority).toBe(-2);
    expect(readTaskLine("x").priority).toBe(0);
  });

  it("위키링크는 본문에 남긴다", () => {
    // 링크를 필드로 오해해 떼어내면 태스크가 노트와의 연결을 잃는다(§307).
    expect(readTaskLine("[[202607051530]] 절 쓰기").body).toBe(
      "[[202607051530]] 절 쓰기",
    );
  });

  it("장식으로 쓴 이모지는 필드가 아니다", () => {
    // 유효한 날짜가 뒤따르지 않으면 구간이 아니다 — 삼키면 사용자 글자가 사라진다.
    const d = readTaskLine("케이크 사기 🎂 📅2026-08-30");
    expect(d.body).toBe("케이크 사기 🎂");
    expect(d.dates.due).toBe("2026-08-30");
  });

  it("같은 필드가 두 번이면 처음 것을 쓴다 — Rust 파서와 같은 규칙", () => {
    expect(readTaskLine("x 📅2026-08-30 📅2026-09-30").dates.due).toBe(
      "2026-08-30",
    );
  });

  it("우리가 순서를 주장하지 않는 토큰은 잃지 않는다", () => {
    // 반복(🔁)은 값이 자유 텍스트라 아직 폼이 다루지 않는다. 본문에 섞어 두면 저장할
    // 때 본문 중간으로 들어가고, 다시 읽으면 또 옮겨져 줄이 매번 달라진다.
    const d = readTaskLine("주간 회고 🔁 📅2026-08-30");
    expect(d.body).toBe("주간 회고");
    expect(d.rest).toEqual(["🔁"]);
    expect(writeTaskLine(d)).toBe("주간 회고 📅2026-08-30 🔁");
  });
});

describe("writeTaskLine", () => {
  it("빈 필드는 쓰지 않는다 — 지우기가 그렇게 동작한다", () => {
    const d = readTaskLine("초안 📅2026-08-30 ⏫");
    d.dates.due = "";
    d.priority = 0;
    expect(writeTaskLine(d)).toBe("초안");
  });

  it("태그는 이모지 필드 앞이다 — 캡처와 같은 자리", () => {
    expect(
      writeTaskLine({
        body: "초안",
        dates: { due: "2026-08-30" },
        priority: 0,
        rest: [],
        tags: ["work"],
      }),
    ).toBe("초안 #work 📅2026-08-30");
  });

  it("태그의 `#`은 있든 없든 한 번만 붙는다", () => {
    expect(
      writeTaskLine({
        body: "초안",
        dates: {},
        priority: 0,
        rest: [],
        tags: ["#work"],
      }),
    ).toBe("초안 #work");
  });
});
