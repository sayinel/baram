// §312 정리 메뉴가 창 밖으로 잘리던 결함의 **배선**을 고정한다.
//
// 좌표를 정하는 산술 자체는 `utils/__tests__/menu-placement.test.ts`가 실제 숫자로
// 시험한다. 여기서 묻는 것은 다른 질문이다: 그 산술이 **연결되어 있는가** — 메뉴가
// 자기 크기를 재고, 행의 사각형과 창 크기를 그 함수에 넣고, 돌아온 좌표를 실제로
// 인라인 style에 쓰는가. 두 파일이 갈려 있어야 하는 이유는, 산술만 맞고 배선이
// 끊겨도(또는 그 반대여도) 결함은 그대로 남기 때문이다.
//
// jsdom에는 레이아웃이 없어 모든 rect가 0이다. 그래서 이 파일은 `getBoundingClientRect`를
// 행과 메뉴에 대해서만 스텁해 "행은 창 아래쪽에 있고 메뉴는 150px 높다"는 상황을 만든다 —
// 렌더된 결과의 기하를 믿는 것이 아니라, 컴포넌트가 **받은 숫자로 무엇을 하는지**를 본다.
import type { TaskEntry } from "../../../ipc/types";

import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MENU_VIEWPORT_MARGIN } from "../../../utils/menu-placement";
import { TaskBucketList } from "../TaskBucketList";

const MENU_HEIGHT = 150;
const MENU_WIDTH = 180;

const realRect = Element.prototype.getBoundingClientRect;

function noop() {}

function openMenuOnRow(): HTMLElement {
  const { container } = render(
    <TaskBucketList
      bucket="today"
      label="Today"
      now={new Date()}
      onJump={noop}
      onToggle={noop}
      onTriage={noop}
      showAge={false}
      showLateDays={false}
      tasks={[task()]}
      titleFor={(x) => x}
    />,
  );
  const row = container.querySelector("li.task-row");
  expect(row).not.toBeNull();
  fireEvent.contextMenu(row!);
  const menu = container.querySelector<HTMLElement>(".task-row-menu");
  expect(menu).not.toBeNull();
  return menu!;
}

function rect(over: Partial<DOMRect>): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...over,
  } as DOMRect;
}

/** 클래스로 rect를 지어낸다. 그 밖의 요소는 jsdom의 0 사각형 그대로 둔다. */
function stubRects(row: { bottom: number; left: number; top: number }) {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains("task-row-menu")) {
      return rect({ height: MENU_HEIGHT, width: MENU_WIDTH });
    }
    if (this.classList.contains("task-row")) {
      return rect({ ...row, height: row.bottom - row.top });
    }
    return realRect.call(this);
  };
}

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "a.md",
    priority: 0,
    raw: "- [ ] 하나",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "하나",
    timer: null,
    ...over,
  };
}

describe("triage menu placement is wired to the viewport (§312)", () => {
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
  });

  it("자리가 있으면 행 바로 아래·왼쪽 맞춤에 그대로 뜬다", () => {
    // 창은 jsdom 기본값 1024×768. 100+150은 넉넉히 들어간다.
    stubRects({ bottom: 120, left: 30, top: 100 });
    const menu = openMenuOnRow();
    expect(menu.style.top).toBe("120px");
    expect(menu.style.left).toBe("30px");
  });

  it("행이 창 아래쪽이면 메뉴가 행 위로 뒤집힌다 — 잘리지 않는다", () => {
    // 사용자 스크린샷의 상황: 720 + 150 = 870 > 768.
    stubRects({ bottom: 720, left: 30, top: 700 });
    const menu = openMenuOnRow();
    expect(menu.style.top).toBe(`${700 - MENU_HEIGHT}px`);
    // 뒤집혀도 그 행에 붙어 있다.
    expect(Number.parseInt(menu.style.top, 10) + MENU_HEIGHT).toBe(700);
  });

  it("오른쪽에 자리가 없으면 왼쪽으로 민다", () => {
    stubRects({ bottom: 120, left: 900, top: 100 });
    const menu = openMenuOnRow();
    expect(menu.style.left).toBe(
      `${window.innerWidth - MENU_VIEWPORT_MARGIN - MENU_WIDTH}px`,
    );
  });
});
