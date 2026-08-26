// §312 Someday 필터 컨트롤이 태스크 행처럼 보이던 결함.
//
// `.task-panel-someday`는 체크박스 하나 + 단어 하나로만 이루어져 있었고, 그 자리에서
// 렌더되는 각 태스크 행(`.task-row`)도 정확히 같은 모양(체크박스 + 텍스트)이다. 필터
// select 3개와 한 줄(`.task-panel-selects`)에 있어도, select들은 flex-basis 96px로
// 서로 접히는데 이 라벨만 `flex: 0 1 auto`라 혼자 다음 줄로 밀려나 맨 위 버킷
// 헤더 바로 위에 "체크박스 하나 + Someday"만 남는다 — 고아 태스크로 오인된 사용자
// 신고의 근거.
//
// 실제 결함은 줄바꿈 위치가 아니라 **컨트롤이 데이터와 같은 모양을 하고 있다는 것**
// 이다(팀 리드 진단). `.task-row`는 테두리도 배경도 없고 hover에서만 배경이 붙는다
// (tasks.css:83-93) — 그래서 이 파일은 `.task-panel-someday`가 상시 테두리+배경 프레임을
// 가져 `.task-row`와 시각 어휘가 갈리는지, 그리고 select와 같은 상자 언어(배경·테두리·
// 라운드)를 입어 필터 줄의 일원으로 읽히는지를 고정한다.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules, objectProperty } from "./css-rules";

const RULES = cssRules();

function propertyOf(body: string, prop: string): null | string {
  return objectProperty(
    cssDeclarations(body)
      .map((d) => `${d.prop}:${d.value}`)
      .join(","),
    new RegExp(`^${prop}$`),
  );
}

function ruleFor(selector: string) {
  const rule = RULES.find((r) => r.selector === selector);
  if (!rule) throw new Error(`no CSS rule found for ${selector}`);
  return rule;
}

describe("Someday filter control does not read as a task row (§312)", () => {
  it("found the base rule, so the checks below are not vacuous", () => {
    expect(
      RULES.filter((r) => r.selector.includes("task-panel-someday")).length,
    ).toBeGreaterThan(0);
  });

  it("a plain task row carries no persistent border — the shape this control must not share", () => {
    const taskRow = ruleFor(".task-row");
    expect(propertyOf(taskRow.body, "border")).toBeNull();
  });

  it("frames itself with a border, unlike a bare task row", () => {
    const someday = ruleFor(".task-panel-someday");
    expect(propertyOf(someday.body, "border")).not.toBeNull();
  });

  it("frames itself with a background, unlike a bare task row", () => {
    const someday = ruleFor(".task-panel-someday");
    expect(propertyOf(someday.body, "background")).not.toBeNull();
  });

  it("matches the filter selects' box language — same border color and radius", () => {
    const select = ruleFor(".task-panel-select");
    const someday = ruleFor(".task-panel-someday");
    expect(propertyOf(someday.body, "border-radius")).toBe(
      propertyOf(select.body, "border-radius"),
    );
    // border 전체(폭+스타일+색)까지 select와 같은 값이어야 "같은 상자 언어"가 된다.
    expect(propertyOf(someday.body, "border")).toBe(
      propertyOf(select.body, "border"),
    );
  });

  it("signals the active filter state distinctly from the resting chip", () => {
    // 체크됐을 때는(필터가 실제로 걸려 있을 때는) 대기 상태와 시각적으로 갈려야
    // "필터가 켜져 있다"는 사실이 보인다 — 그렇지 않으면 컨트롤은 켜졌는지조차
    // 알 수 없는 상시-동일 상자가 된다.
    const checked = RULES.find(
      (r) =>
        r.selector.startsWith(".task-panel-someday") &&
        r.selector.includes(":has(") &&
        r.selector.includes("checked"),
    );
    expect(checked).toBeDefined();

    const resting = ruleFor(".task-panel-someday");
    const restingBorderColor = propertyOf(resting.body, "border");
    const restingBg = propertyOf(resting.body, "background");
    const checkedBorderColor = propertyOf(checked!.body, "border-color");
    const checkedBg = propertyOf(checked!.body, "background");

    // 적어도 하나(테두리색 또는 배경)는 대기 상태와 달라야 한다.
    const borderChanged =
      checkedBorderColor !== null && checkedBorderColor !== restingBorderColor;
    const bgChanged = checkedBg !== null && checkedBg !== restingBg;
    expect(borderChanged || bgChanged).toBe(true);
  });
});
