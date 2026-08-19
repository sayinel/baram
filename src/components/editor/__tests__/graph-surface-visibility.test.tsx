// §286 — 그래프는 **보이지 않는 동안** 뷰포트 작업을 하지 않는다.
//
// ‼️ 실앱에서 두 갈래로 드러났다.
//   · 그래프 ↔ 여러 MD를 오가면 그래프 위치가 조금씩 달라진다.
//   · 그래프 ↔ PDF/HTML은 레이아웃이 구석으로 뭉갠다.
//
// 원인은 하나다. `useGraphFilter`의 effect는 `activeFilePath`를 deps에 갖고 있어 **탭을 바꿀
// 때마다** 돈다 — 그래프가 숨어 있어도. 그 안에서 `cy.fit()`(use-graph-filter.ts)과
// `cy.resize()`(use-graph-data.ts)가 컨테이너를 재는데, `display: none`이면 0×0이라
// 뷰포트가 degenerate해진다. 그 전에도 이 코드는 있었지만, 예전에는 그래프 탭을 떠나면
// 언마운트됐기 때문에 숨은 채로 돌 일이 없었다.
//
// 여기서 고정하는 성질은 "그래프가 자기 화면을 가졌을 때만 화면 계산을 한다"이다.
import { describe, expect, it } from "vitest";

import { shouldRunViewportWork } from "../../sidebar/graph-viewport";

describe("shouldRunViewportWork", () => {
  it("is false while the surface is hidden", () => {
    expect(shouldRunViewportWork(false, { height: 800, width: 1200 })).toBe(
      false,
    );
  });

  it("is false when the container has no size, even if marked visible", () => {
    // display:none을 막 벗어난 프레임처럼, 활성 표시와 실제 레이아웃이 어긋날 수 있다.
    expect(shouldRunViewportWork(true, { height: 0, width: 0 })).toBe(false);
    expect(shouldRunViewportWork(true, { height: 800, width: 0 })).toBe(false);
    expect(shouldRunViewportWork(true, { height: 0, width: 1200 })).toBe(false);
  });

  it("is true only when visible with a real box", () => {
    expect(shouldRunViewportWork(true, { height: 800, width: 1200 })).toBe(
      true,
    );
  });

  it("treats a missing container as no box", () => {
    expect(shouldRunViewportWork(true, null)).toBe(false);
  });
});
