// §312 행의 빈 자리를 우클릭하면 정리 메뉴의 **모든 항목이 선택색으로 칠해지던** 결함.
//
// 우클릭이 문서 텍스트 선택을 만들거나 늘리고, 그 직후 같은 문서에 그려진 메뉴가 그
// 선택 범위 안에 들어가 하이라이트로 칠해진다(사용자 스크린샷). 메뉴는 문서의 내용이
// 아니라 컨트롤이므로 애초에 선택 대상이 아니어야 한다 — 그러면 어떤 선택이 남아 있든
// 칠할 것이 없다.
//
// 그리고 원인 쪽: 사용자가 누른 "텍스트 오른쪽 빈 자리"는 `<li>`의 여백이 **아니라**
// `.task-row-text` 버튼 안이다. 그 버튼이 `flex: 1`이라 행의 남는 가로 공간을 전부
// 가져가기 때문이다. 그래서 행에서 선택을 끄되 버튼만 다시 켜는 처방은 결함이 신고된
// 바로 그 자리를 비워 두게 된다 — 아래 두 시험이 그 사실을 함께 고정한다.
//
// ‼️ 이 파일은 **선언**을 고정하지 렌더 결과를 고정하지 않는다. jsdom에는 레이아웃도
// 선택 페인트도 없으므로 "하이라이트가 사라졌다"를 여기서 물을 방법은 없다. 물을 수
// 있는 것은 배포되는 스타일시트가 그 선언을 실제로 담고 있는가이고, 이 디렉터리의
// `css-rules.ts` 관례가 그것을 읽는다.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

const RULES = cssRules();

function ruleFor(selector: string) {
  const rule = RULES.find((r) => r.selector === selector);
  if (!rule) throw new Error(`no CSS rule found for ${selector}`);
  return rule;
}

function userSelectOf(selector: string): null | string {
  const found = cssDeclarations(ruleFor(selector).body).find(
    (d) => d.prop === "user-select",
  );
  return found?.value ?? null;
}

describe("triage menu text is never selectable (§312)", () => {
  it("찾으려는 규칙들이 실제로 있다 — 아래 단언이 공허하지 않다", () => {
    expect(() => ruleFor(".task-row-menu")).not.toThrow();
    expect(() => ruleFor(".task-row")).not.toThrow();
    expect(() => ruleFor(".task-row-text")).not.toThrow();
  });

  it("메뉴는 선택되지 않는다 — 하이라이트가 칠할 글자가 없다", () => {
    expect(userSelectOf(".task-row-menu")).toBe("none");
  });

  it("행도 선택되지 않는다 — 우클릭이 선택을 만들지 못하게 원인 쪽을 막는다", () => {
    expect(userSelectOf(".task-row")).toBe("none");
  });

  it("이 패널의 관례를 따른다 — someday 필터 컨트롤과 같은 값", () => {
    // 컨트롤은 내용이 아니다. `.task-panel-someday`가 이 패널에서 그 관례를 먼저 세웠다.
    expect(userSelectOf(".task-row-menu")).toBe(
      userSelectOf(".task-panel-someday"),
    );
  });

  it("행의 텍스트 버튼이 남는 가로 공간을 다 가져간다 (flex: 1)", () => {
    // 이 한 줄이 "빈 자리는 버튼 안"이라는 사실의 근거다. 여기가 `flex: 0`으로 바뀌면
    // 빈 자리는 `<li>`의 것이 되고, 아래 시험이 지키는 규칙의 이유도 달라진다.
    const flex = cssDeclarations(ruleFor(".task-row-text").body).find(
      (d) => d.prop === "flex",
    );
    expect(flex?.value).toBe("1");
  });

  it("행 안쪽에서 선택을 되살리는 규칙이 없다", () => {
    // `.task-row-text { user-select: text }`로 "태스크 글자는 복사할 수 있어야지"를
    // 되살리고 싶어지는 자리다. 그것이 정확히 사용자가 우클릭한 자리이므로 되살리면
    // 결함이 함께 돌아온다. 행 전체가 컨트롤이다 — 클릭은 이동, 우클릭은 메뉴,
    // j/k/d/t/s는 키 경로다.
    const reenabled = RULES.filter(
      (rule) =>
        rule.selector.includes(".task-row") &&
        cssDeclarations(rule.body).some(
          (d) => d.prop === "user-select" && d.value !== "none",
        ),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(reenabled).toEqual([]);
  });
});
