// §312 화면 밖으로 잘리던 컨텍스트 메뉴의 **결정**을 고정한다.
//
// 왜 순수 함수를 따로 두고 그것을 시험하는가: 이 결함은 기하학이고 jsdom에는 레이아웃이
// 없다 — 모든 요소의 rect가 0이라 "실제로 화면 안에 들어갔는가"를 렌더 결과로 물으면
// 어떤 배치 규칙을 넣어도 통과한다. 그래서 좌표를 정하는 산술만 떼어내 실제 숫자로
// 시험하고, 그 산술이 컴포넌트에 **연결되어 있는지**는 별도 파일
// (components/tasks/__tests__/task-row-menu-placement.test.tsx)이 rect를 스텁해 고정한다.
import { describe, expect, it } from "vitest";

import { MENU_VIEWPORT_MARGIN, placeMenu } from "../menu-placement";

/** 세로 150 · 가로 180 — 정리 메뉴의 실제 크기대(항목 4~5개)에 있는 값. */
const SIZE = { height: 150, width: 180 };
const VIEWPORT = { height: 800, width: 1000 };
const M = MENU_VIEWPORT_MARGIN;

describe("placeMenu (§312)", () => {
  it("자리가 있으면 앵커 바로 아래·왼쪽 맞춤 — 기본 배치는 움직이지 않는다", () => {
    const at = placeMenu({ bottom: 120, left: 50, top: 100 }, SIZE, VIEWPORT);
    expect(at).toEqual({ x: 50, y: 120 });
  });

  it("아래에 자리가 없으면 행 위로 뒤집는다", () => {
    // 720 + 150 = 870 > 800. 아래로 두면 잘린다.
    const at = placeMenu({ bottom: 720, left: 50, top: 700 }, SIZE, VIEWPORT);
    expect(at.y).toBe(550);
  });

  it("뒤집어도 그 행에 붙어 있다 — 메뉴 아래끝이 행 윗변에 닿는다", () => {
    // 엉뚱한 구석으로 튀지 않는다는 것이 뒤집기의 조건이다.
    const anchor = { bottom: 720, left: 50, top: 700 };
    const at = placeMenu(anchor, SIZE, VIEWPORT);
    expect(at.y + SIZE.height).toBe(anchor.top);
  });

  it("아래에 한 픽셀이라도 남으면 뒤집지 않는다", () => {
    // y + 150 === 800 - margin 인 경계. 여기서 뒤집으면 멀쩡한 배치를 흔드는 것이다.
    const anchor = {
      bottom: VIEWPORT.height - M - SIZE.height,
      left: 50,
      top: 0,
    };
    expect(placeMenu(anchor, SIZE, VIEWPORT).y).toBe(anchor.bottom);
  });

  it("오른쪽에 자리가 없으면 왼쪽으로 민다 — 오른쪽 여백에 맞춰 선다", () => {
    const at = placeMenu({ bottom: 120, left: 900, top: 100 }, SIZE, VIEWPORT);
    expect(at.x).toBe(VIEWPORT.width - M - SIZE.width);
    expect(at.x + SIZE.width).toBe(VIEWPORT.width - M);
  });

  it("위아래 어느 쪽에도 안 들어가면 아래 여백에 맞춰 세운다", () => {
    // 창이 낮아 아래(80+150=230>200)도 위(60-150=-90)도 안 된다.
    const shortViewport = { height: 200, width: 1000 };
    const at = placeMenu(
      { bottom: 80, left: 50, top: 60 },
      SIZE,
      shortViewport,
    );
    expect(at.y).toBe(shortViewport.height - M - SIZE.height);
    expect(at.y + SIZE.height).toBe(shortViewport.height - M);
  });

  it("메뉴가 창보다 높으면 위 여백에 고정한다 — 첫 항목이 보이는 쪽을 남긴다", () => {
    // 아래 여백에 맞추면 y가 음수가 되어 **머리**가 잘린다. 항목은 자주 쓰는 것이
    // 위, 파괴적인 것이 아래이므로 남길 쪽은 위다.
    const at = placeMenu(
      { bottom: 80, left: 50, top: 60 },
      { height: 400, width: 180 },
      { height: 200, width: 1000 },
    );
    expect(at.y).toBe(M);
  });

  it("메뉴가 창보다 넓으면 왼쪽 여백에 고정한다", () => {
    const at = placeMenu(
      { bottom: 120, left: 50, top: 100 },
      { height: 150, width: 300 },
      { height: 800, width: 100 },
    );
    expect(at.x).toBe(M);
  });

  it("앵커가 이미 화면 왼쪽/위 밖이어도 여백 안으로 끌어온다", () => {
    const at = placeMenu({ bottom: -40, left: -60, top: -60 }, SIZE, VIEWPORT);
    expect(at.x).toBe(M);
    expect(at.y).toBeGreaterThanOrEqual(M);
  });

  it("포인터 앵커(위=아래)도 같은 규칙을 탄다 — 뒤집으면 커서에서 끝난다", () => {
    // 파일 트리 메뉴는 행이 아니라 커서 위치에 뜬다. 점은 높이 0인 사각형이므로
    // 이 함수 하나가 두 메뉴를 모두 덮는다.
    const cursorY = 790;
    const at = placeMenu(
      { bottom: cursorY, left: 10, top: cursorY },
      SIZE,
      VIEWPORT,
    );
    expect(at.y + SIZE.height).toBe(cursorY);
  });
});
