// §352 — 서체 브라우저는 자기 안에서 스크롤해야 한다.
//
// 결함의 모양(동훈님 보고): `.font-browser` 에 높이 상한이 없고 `min-height: 420px`
// 라는 바닥만 있었다. 그러면 넘치는 쪽은 브라우저가 아니라 부모인
// `.settings-content` 라서, 목록 아래쪽 서체를 고르면 오른쪽 미리보기도 위쪽
// "← 에디터 설정" 버튼도 함께 화면 밖으로 밀려 올라간다 — 예제를 보려고, 또
// 되돌아가려고 매번 스크롤을 다시 올려야 했다.
//
// jsdom 은 레이아웃을 계산하지 않으므로 "무엇이 스크롤되는가" 를 렌더로 물을 수
// 없다. 물을 수 있는 것은 선언이다. 세 가지가 함께 참이어야 브라우저가 자기 안에서
// 스크롤한다: 높이 상한이 있을 것 · 바닥이 부모가 가질 수 있는 높이를 넘지 않을 것 ·
// 스크롤러가 목록일 것. 그래서 셋을 따로 단정한다 — 상한만 보는 가드는
// `min-height` 로 되돌아온 바닥을 그대로 통과시킨다.
import type { Rule } from "./css-rules";

import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

const RULES = cssRules();

function rulesFor(selector: string): Rule[] {
  return RULES.filter((rule) => rule.selector === selector);
}

/** 해당 셀렉터의 규칙들이 마지막으로 선언한 값 (없으면 undefined). */
function declared(selector: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const rule of rulesFor(selector)) {
    for (const declaration of cssDeclarations(rule.body)) {
      if (declaration.prop === prop) found = declaration.value;
    }
  }
  return found;
}

function px(value: string | undefined): null | number {
  if (value === undefined) return null;
  const match = /^(\d+(?:\.\d+)?)px$/u.exec(value);
  return match === null ? null : Number(match[1]);
}

describe("font browser scrolling", () => {
  it("binds the browser to the height of the pane it sits in", () => {
    const bound =
      declared(".font-browser", "height") ??
      declared(".font-browser", "max-height");
    expect(bound).toBeDefined();
  });

  // 부모가 가질 수 있는 최소 높이보다 큰 바닥은 그 자체로 바깥 스크롤을 만든다 —
  // 창이 낮을 때 `.settings-content` 는 정확히 그 최소값이 되기 때문이다.
  it("never floors the browser taller than the settings pane can be", () => {
    const floor = px(declared(".font-browser", "min-height"));
    if (floor === null) return; // 바닥이 없으면 이 결함은 불가능하다
    const pane = px(declared(".settings-content", "min-height"));
    expect(pane).not.toBeNull();
    expect(floor).toBeLessThanOrEqual(pane as number);
  });

  it("makes the family list the scroller, and the preview its own", () => {
    expect(declared(".font-browser-list", "overflow-y")).toBe("auto");
    expect(declared(".font-browser-preview", "overflow-y")).toBe("auto");
  });

  // 목록이 스크롤하려면 자기 몫의 높이가 있어야 한다. `min-height: 0` 이 없으면
  // flex 항목의 기본 최소 크기가 내용 높이라서, 목록이 줄어들지 않고 대신 부모가
  // 넘친다 — 위 `overflow-y` 선언은 그대로 둔 채 스크롤러만 다시 바깥으로 간다.
  it("lets the two panes shrink so the overflow lands inside them", () => {
    expect(declared(".font-browser-body", "min-height")).toBe("0");
  });
});
