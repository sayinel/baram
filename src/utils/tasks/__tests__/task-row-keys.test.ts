// §312 아젠다 행의 키 바인딩 표 — "네 판정 모두 키 한 번"이 성립하는지.
//
// 컴포넌트 밖의 순수 표라 React 없이 검증한다. §315(주간 리뷰)가 같은 표를 그대로
// 물려받으므로, 여기서 고정한 것이 두 화면의 **공통** 계약이다.
import { describe, expect, it } from "vitest";

import { resolveTaskRowKey, TASK_ROW_KEYSHORTCUTS } from "../task-row-keys";

function key(k: string, mods: Partial<Record<string, boolean>> = {}) {
  return resolveTaskRowKey({
    altKey: false,
    ctrlKey: false,
    key: k,
    metaKey: false,
    ...mods,
  });
}

describe("§312 네 판정이 각각 키 하나다", () => {
  it("x는 체크 판정이다", () => {
    expect(key("x")).toEqual({ action: "check", kind: "triage" });
  });

  it("t는 오늘 기한 판정이다", () => {
    expect(key("t")).toEqual({ action: "dueToday", kind: "triage" });
  });

  it("s는 someday 판정이다", () => {
    expect(key("s")).toEqual({ action: "someday", kind: "triage" });
  });

  // 파괴적 판정만 글자키가 아니다 — 오타 한 번이 되돌릴 수 없는 조작이 되면 안 된다.
  it("Delete와 Backspace가 삭제 판정이다", () => {
    expect(key("Delete")).toEqual({ action: "delete", kind: "triage" });
    expect(key("Backspace")).toEqual({ action: "delete", kind: "triage" });
  });

  it("네 판정의 키가 서로 겹치지 않는다", () => {
    const actions = ["x", "t", "s", "Delete"].map(
      (k) => (key(k) as { action: string }).action,
    );
    expect(new Set(actions).size).toBe(4);
  });
});

describe("§312 이동과 메뉴는 그대로다", () => {
  it("j/ArrowDown은 아래로, k/ArrowUp은 위로", () => {
    expect(key("j")).toEqual({ delta: 1, kind: "focus" });
    expect(key("ArrowDown")).toEqual({ delta: 1, kind: "focus" });
    expect(key("k")).toEqual({ delta: -1, kind: "focus" });
    expect(key("ArrowUp")).toEqual({ delta: -1, kind: "focus" });
  });

  it("d는 메뉴를 연다 — 삭제가 아니다", () => {
    expect(key("d")).toEqual({ kind: "menu" });
  });
});

// ‼️ 수식키가 붙은 것은 앱 단축키다(Cmd+K 등). 여기서 삼키면 행에 포커스가 있는 동안
// 그 단축키가 통째로 죽는다.
describe("§312 수식키가 붙으면 행은 손대지 않는다", () => {
  it("Cmd/Ctrl/Alt 조합은 전부 통과시킨다", () => {
    expect(key("k", { metaKey: true })).toBeNull();
    expect(key("d", { ctrlKey: true })).toBeNull();
    expect(key("x", { altKey: true })).toBeNull();
    expect(key("Delete", { metaKey: true })).toBeNull();
  });
});

describe("§312 표에 없는 키", () => {
  it("아무 일도 하지 않는다", () => {
    expect(key("a")).toBeNull();
    expect(key("Enter")).toBeNull();
    expect(key(" ")).toBeNull();
  });
});

describe("aria-keyshortcuts", () => {
  // 보조기술이 읽는 목록과 실제 바인딩이 갈리면 그 목록은 거짓말이다.
  it("네 판정과 메뉴 키를 모두 알린다", () => {
    for (const k of ["X", "T", "S", "Delete", "D"]) {
      expect(TASK_ROW_KEYSHORTCUTS.split(" ")).toContain(k);
    }
  });

  it("알리는 키가 전부 실제로 동작한다", () => {
    for (const k of TASK_ROW_KEYSHORTCUTS.split(" ")) {
      expect(key(k.length === 1 ? k.toLowerCase() : k)).not.toBeNull();
    }
  });
});
