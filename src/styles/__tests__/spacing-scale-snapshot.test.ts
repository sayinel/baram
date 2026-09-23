// §365.2 다이얼 4·5 선행. 이 스냅샷의 **일**은 리팩터가 픽셀을 바꿨는지 말하는 것이다.
//
// 무엇이 이것을 실패시키는가: 간격이나 모서리 선언의 **계산값**이 바뀌면 실패한다.
// 토큰으로 바꾸기만 하고 값이 같으면(`8px` → `var(--space-2)`) 통과한다 — 그것이
// 0097 Task 2 가 값을 보존했다는 증거다. Task 3 은 일부러 실패시키고, 그 diff 가
// 리뷰 표면이다.
//
// ‼️ 셀렉터 이름을 바꾸거나 규칙을 옮겨도 실패한다. 이 스냅샷은 값만이 아니라
// (파일·셀렉터·속성) 자리까지 고정한다 — 리팩터 중에 규칙이 사라지는 것도 결함이다.
import { expect, it } from "vitest";

import {
  RADIUS_TOKENS,
  resolvedSpacingDeclarations,
  SPACE_TOKENS,
} from "./spacing-scale";

// 비공허성: 정규식이 깨지면 표가 비고, 아래 해상도 맵의 모든 치환이 조용히
// no-op 이 되어 스냅샷은 "리터럴 그대로" 를 찍으며 초록으로 남는다.
// 개수를 고정하는 이유는 그 무증상을 관측하기 위해서다.
it("primitives.css 에서 간격 16 · 모서리 8 토큰을 읽는다", () => {
  expect(Object.keys(SPACE_TOKENS)).toHaveLength(16);
  expect(Object.keys(RADIUS_TOKENS)).toHaveLength(8);
  expect(SPACE_TOKENS["--space-1"]).toBe("4px");
  expect(RADIUS_TOKENS["--radius-full"]).toBe("9999px");
});

it("간격·모서리 선언의 계산값이 그대로다", () => {
  expect(resolvedSpacingDeclarations()).toMatchSnapshot();
});

// 비공허성: 위 스냅샷은 맵이 **비어도** 통과한다(빈 배열도 스냅샷이 된다).
it("스냅샷이 비어 있지 않다", () => {
  expect(resolvedSpacingDeclarations().length).toBeGreaterThan(1500);
});
