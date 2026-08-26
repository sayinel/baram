import type { EditorTab } from "../../../stores/editor/editor";

// §313 스크롤 요청은 **파일에 주소가 붙는다**.
//
// 이 파일이 지키는 것은 두 가지 사실이다:
//
// 1. 요청이 향한 파일이 실제로 열렸을 때에만 소비된다. 주소가 다른 탭이 도착하면
//    적용하지 않고 **버린다** — 남겨 두면 다음 탭 전환이 그것을 집어 엉뚱한 파일을
//    그 줄 번호로 스크롤한다. 태스크 클릭이 아젠다에서 실패했을 때 사용자가 실제로
//    본 증상이 그것이다.
// 2. 이미 활성인 탭을 향한 요청은 탭 전환이 일어나지 않으므로 `use-tab-switching`의
//    어떤 소비자도 돌지 않는다. 그 경우를 판정하는 기준은 "요청 당시 활성이던 탭이
//    지금도 활성인가"다 — 활성 탭의 경로만 비교하면, 배경 탭으로의 전환이 같은 커밋에서
//    이미 스토어에 반영된 순간(React 배치) 아직 옛 문서를 들고 있는 에디터를 스크롤하고
//    요청까지 삼킨다.
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import {
  requestScroll,
  takePendingScroll,
  takeSameTabScroll,
} from "../pending-scroll";

const tab = (id: string, filePath: string): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

const A = tab("ta", "/v/a.md");
const B = tab("tb", "/v/b.md");

function pending() {
  const s = useLinkStore.getState();
  return {
    blockId: s.pendingScrollBlockId,
    heading: s.pendingScrollHeading,
    line: s.pendingScrollLine,
    path: s.pendingScrollPath,
  };
}

beforeEach(() => {
  useLinkStore.getState().clearPendingScroll();
  useEditorStore.setState({ activeTabId: "ta", mruOrder: [], tabs: [A, B] });
});

describe("requestScroll — 주소가 붙은 스크롤 요청", () => {
  it("한 종류만 남기고 나머지 대상은 지운다", () => {
    requestScroll("/v/a.md", { kind: "heading", value: "Intro" });
    requestScroll("/v/a.md", { kind: "line", value: 12 });

    expect(pending()).toEqual({
      blockId: null,
      heading: null,
      line: 12,
      path: "/v/a.md",
    });
  });
});

describe("takePendingScroll — 도착한 탭이 소비한다", () => {
  it("주소가 맞으면 대상을 돌려주고 요청을 비운다", () => {
    requestScroll("/v/a.md", { kind: "line", value: 12 });

    expect(takePendingScroll("/v/a.md")).toEqual({ kind: "line", value: 12 });
    expect(pending()).toEqual({
      blockId: null,
      heading: null,
      line: null,
      path: null,
    });
  });

  it("주소가 다르면 적용하지 않고, 남겨 두지도 않는다", () => {
    // ‼️ 이 테스트의 두 번째 기대가 결함의 본체다. 예전에는 소비자가 돌지 않으면 값이
    // 그대로 남아 **다음** 탭 전환이 그것을 집었다 — 열지도 않은 파일의 줄 번호로
    // 사용자가 방금 연 문서를 스크롤한다.
    requestScroll("/v/a.md", { kind: "line", value: 12 });

    expect(takePendingScroll("/v/b.md")).toBeNull();
    expect(pending()).toEqual({
      blockId: null,
      heading: null,
      line: null,
      path: null,
    });
  });

  it("주소가 없는 옛 요청은 도착한 탭이 그대로 소비한다", () => {
    // use-navigation의 위키링크/블록참조는 여전히 주소 없는 setter를 쓴다 —
    // 그 경로들은 자기 안에서 같은 파일 경우를 이미 다루므로 건드리지 않았다.
    useLinkStore.getState().setPendingScrollHeading("Intro");

    expect(takePendingScroll("/v/b.md")).toEqual({
      kind: "heading",
      value: "Intro",
    });
  });
});

describe("takeSameTabScroll — 이미 활성인 탭이 소비한다", () => {
  it("요청 당시 활성이던 탭이 그 파일을 이미 보고 있으면 소비한다", () => {
    requestScroll("/v/a.md", { kind: "line", value: 12 });

    expect(takeSameTabScroll()).toEqual({ kind: "line", value: 12 });
    expect(pending().path).toBeNull();
  });

  it("다른 파일을 향한 요청은 건드리지 않는다 — 탭 전환이 배달한다", () => {
    requestScroll("/v/b.md", { kind: "line", value: 12 });

    expect(takeSameTabScroll()).toBeNull();
    expect(pending()).toEqual({
      blockId: null,
      heading: null,
      line: 12,
      path: "/v/b.md",
    });
  });

  it("요청 뒤에 활성 탭이 바뀌었으면 건드리지 않는다 — 그 전환이 배달한다", () => {
    // 배경 탭 경우: `setActiveTab`이 같은 커밋에서 이미 스토어를 바꿔 놓았으므로
    // "활성 탭의 경로"만 보면 여기서 통과해 버린다. 그런데 에디터는 아직 나가는
    // 문서를 들고 있다 — 소비하면 그 문서를 스크롤하고 요청을 삼킨다.
    requestScroll("/v/b.md", { kind: "line", value: 12 });
    useEditorStore.setState({ activeTabId: "tb" });

    expect(takeSameTabScroll()).toBeNull();
    expect(pending().line).toBe(12);
  });

  it("주소 없는 요청은 건드리지 않는다", () => {
    useLinkStore.getState().setPendingScrollHeading("Intro");

    expect(takeSameTabScroll()).toBeNull();
    expect(useLinkStore.getState().pendingScrollHeading).toBe("Intro");
  });
});
