// §312 아젠다 행의 키 바인딩 표 — "네 판정 모두 키 한 번"이 성립하는지.
//
// 컴포넌트 밖의 순수 표라 React 없이 검증한다. §315(주간 리뷰)가 같은 표를 그대로
// 물려받으므로, 여기서 고정한 것이 두 화면의 **공통** 계약이다.
import { describe, expect, it } from "vitest";

import { resolveTaskRowKey, TASK_ROW_KEYSHORTCUTS } from "../task-row-keys";

function key(
  k: string,
  over: Partial<Parameters<typeof resolveTaskRowKey>[0]> = {},
) {
  return resolveTaskRowKey({
    altKey: false,
    ctrlKey: false,
    key: k,
    metaKey: false,
    shiftKey: false,
    ...over,
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
    for (const k of ["X", "T", "S", "Delete", "Backspace", "D"]) {
      expect(TASK_ROW_KEYSHORTCUTS.split(" ")).toContain(k);
    }
  });

  it("알리는 키가 전부 실제로 동작한다", () => {
    for (const k of TASK_ROW_KEYSHORTCUTS.split(" ")) {
      expect(key(k.length === 1 ? k.toLowerCase() : k)).not.toBeNull();
    }
  });
});

// §312 IME. 이 표는 이 슬라이스가 새로 연 **유일한** 키보드 표면인데, 코드베이스가 이미
// IME를 1급 위험으로 다루는 곳(`vim-code-block-boundary.ts:46`, 다이얼로그 셋,
// `src/spike/ime-probe/`)에서 혼자 빠져 있었다.
//
// 두 신호를 따로 막는 이유는 `src/spike/ime-probe`가 측정해 둔 것이 둘로 갈리기 때문이다:
//
// 1. **조합 중 keydown.** 표준 경로(그리고 다이얼로그 셋이 막는 것)는
//    `isComposing`/`keyCode 229`다. 조합을 확정하려고 누른 키가 판정으로 새면, 그 판정은
//    사용자가 이 행에 내린 것이 아니다.
// 2. **한글 배열이 바꿔 놓은 `key`.** 2026-07-26 raw 로그(`cm-instance.ts:112`)에 따르면
//    이 WKWebView의 한글 입력은 조합 이벤트를 **하나도** 내지 않고 `beforeinput`
//    insertText로 넣는다 — 즉 위 1번 신호가 아예 켜지지 않는 경로가 있다. 그때 남는 사실은
//    `vim-code-block-boundary.ts`가 기기에서 확인한 것과 같다: `x`가 `ㅌ`로 온다.
//    1번만 막으면 세 안전한 판정과 메뉴 키가 죽고 `Delete`/`Backspace`만 살아남는다 —
//    한국어 IME 사용자에게 **파괴적 판정만 닿는** 비대칭이 된다.
describe("§312 IME가 가져간 키는 행의 것이 아니다", () => {
  it("조합 중 keydown은 어떤 판정도 내지 않는다", () => {
    for (const k of ["x", "t", "s", "d", "j", "k", "Delete", "Backspace"]) {
      expect(key(k, { isComposing: true })).toBeNull();
    }
  });

  // WebKit은 조합 중 keydown을 keyCode 229로 낸다 — `isComposing`이 붙지 않는 빌드가
  // 있어 두 신호를 함께 본다(`vim-code-block-boundary.ts:45-46`과 같은 짝).
  it("keyCode 229도 같이 막는다", () => {
    for (const k of ["x", "t", "s", "d", "Delete", "Backspace"]) {
      expect(key(k, { keyCode: 229 })).toBeNull();
    }
  });

  // ‼️ 파괴적 판정이 특히 중요하다. `Delete`/`Backspace`는 어떤 입력기도 가져가지 않으므로
  // 조합 중에도 그대로 도착한다 — 여기서 걸러 내지 않으면 IME가 살아 있는 동안 되돌릴 수
  // 없는 조작만 유일하게 반응하는 상태가 된다.
  it("조합 중에는 파괴적 판정도 예외가 아니다", () => {
    expect(key("Delete", { isComposing: true })).toBeNull();
    expect(key("Delete", { keyCode: 229 })).toBeNull();
  });
});

// 한글 배열에서 글자키가 만들어 내는 자모. 물리 키(`code`)가 평범한 글자면 사용자가 누른
// 것은 그 글자다 — 판정은 `layoutKey`(§298 vim 코어)가 이미 갖고 있는 그 규칙을 그대로
// 물려받는다. 여기서 규칙을 새로 쓰면 같은 질문에 답이 둘이 된다.
describe("§312 한글 배열에서도 네 판정에 닿는다", () => {
  it("자모로 도착한 글자키가 원래 판정을 낸다", () => {
    expect(key("ㅌ", { code: "KeyX" })).toEqual({
      action: "check",
      kind: "triage",
    });
    expect(key("ㅅ", { code: "KeyT" })).toEqual({
      action: "dueToday",
      kind: "triage",
    });
    expect(key("ㄴ", { code: "KeyS" })).toEqual({
      action: "someday",
      kind: "triage",
    });
    expect(key("ㅇ", { code: "KeyD" })).toEqual({ kind: "menu" });
  });

  it("j/k 이동도 자모로 온다", () => {
    expect(key("ㅓ", { code: "KeyJ" })).toEqual({ delta: 1, kind: "focus" });
    expect(key("ㅏ", { code: "KeyK" })).toEqual({ delta: -1, kind: "focus" });
  });

  // 폴백은 "한글 문자 + 평범한 글자 물리 키"에서만 열린다. 물리 키를 모르면 라틴 글자로
  // 되돌릴 근거가 없고, 표에 없는 물리 키는 표에 없는 그대로다.
  it("물리 키를 모르면 자모는 그냥 표에 없는 키다", () => {
    expect(key("ㅌ")).toBeNull();
    expect(key("ㅌ", { code: "Digit1" })).toBeNull();
  });

  // Shift가 붙으면 `layoutKey`는 대문자를 돌려준다 — 표는 소문자만 묶으므로 그대로 통과다.
  // 라틴 배열의 Shift+X가 아무 일도 하지 않는 것과 같은 결과여야 한다.
  it("Shift가 붙은 자모는 라틴 대문자와 같은 판정 — 아무 일도 하지 않는다", () => {
    expect(key("ㅌ", { code: "KeyX", shiftKey: true })).toBeNull();
    expect(key("X")).toBeNull();
  });

  // 조합 관문이 배열 폴백보다 **앞**이다. 순서를 뒤집으면 조합 중 자모가 판정으로 풀린다.
  it("조합 중인 자모는 폴백을 타지 않는다", () => {
    expect(key("ㅌ", { code: "KeyX", isComposing: true })).toBeNull();
    expect(key("ㅌ", { code: "KeyX", keyCode: 229 })).toBeNull();
  });
});
