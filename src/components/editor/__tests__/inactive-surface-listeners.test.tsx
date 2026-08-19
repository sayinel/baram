// §288 규칙 1 — 숨은 표면은 전역 리스너를 달지 않는다.
//
// ‼️ 세기 전에 React의 위임 등록을 소진시킨다. React DOM은 `selectionchange`를 document에
// 직접 위임 등록하는데(listenToAllSupportedEvents), **document당 한 번**이라 첫 렌더에서만
// 나타난다. 그 한 건을 빼지 않으면 첫 테스트만 하나 더 세고, 반대로 매번 빼면 두 번째부터
// 하나씩 모자란다 — 실제로 두 실수를 다 겪었다. warmUp으로 먼저 태우고 카운터를 비우면
// 이후 등록은 전부 우리 것이다.
//
// 표면 N개는 **한 루트 안에서** 마운트한다. 루트를 나누면 커밋이 따로 생겨 측정이 흐려진다.
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePdfAreaHighlight } from "../pdf/use-pdf-area-highlight";
import { usePdfSelectionPopup } from "../pdf/use-pdf-selection-popup";

let docTypes: string[];
let winTypes: string[];

beforeEach(() => {
  docTypes = [];
  winTypes = [];
  const realDoc = document.addEventListener.bind(document);
  const realWin = window.addEventListener.bind(window);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (type: string, ...rest: unknown[]) => {
      docTypes.push(type);
      (realDoc as (...a: unknown[]) => void)(type, ...rest);
    },
  );
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, ...rest: unknown[]) => {
      winTypes.push(type);
      (realWin as (...a: unknown[]) => void)(type, ...rest);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const count = (types: string[], type: string) =>
  types.filter((t) => t === type).length;

function mountAreaHighlights(actives: boolean[]) {
  renderHook(() => {
    for (const active of actives) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- 호출 수가 렌더 내내 고정이다
      usePdfAreaHighlight({
        active,
        areaModeOn: false,
        onAreaHighlightDrawn: vi.fn(),
      });
    }
  });
  return { doc: count(docTypes, "keydown"), win: count(winTypes, "blur") };
}

/** actives 길이만큼 선택 팝업 훅을 **한 루트 안에서** 마운트한다. */
function mountSelectionPopups(actives: boolean[]) {
  renderHook(() => {
    for (const active of actives) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- 호출 수가 렌더 내내 고정이다
      usePdfSelectionPopup({
        active,
        onSelect: vi.fn(),
        pageElsRef: { current: new Map() },
        pagesByNumberRef: { current: new Map() },
        pdfRelPath: "papers/a.pdf",
        scale: 1,
        textModeActive: true,
      });
    }
  });
  return count(docTypes, "selectionchange");
}

/** React의 document 위임 등록을 먼저 소진시키고 카운터를 비운다. */
function warmUpReactDelegation() {
  renderHook(() => undefined);
  docTypes = [];
  winTypes = [];
}

describe("usePdfSelectionPopup", () => {
  it("adds one document subscription per ACTIVE surface", () => {
    // 대조군: 활성 표면이 늘면 구독도 는다 — 카운터가 실제로 움직인다는 증거다.
    warmUpReactDelegation();
    expect(mountSelectionPopups([true])).toBe(1);
    docTypes = [];
    expect(mountSelectionPopups([true, true])).toBe(2);
  });

  it("adds nothing for surfaces mounted inactive", () => {
    warmUpReactDelegation();
    expect(mountSelectionPopups([false, false])).toBe(0);
  });

  it("keeps one subscription when a second surface is mounted hidden", () => {
    // 유지 집합의 실제 모양: PDF 두 개가 마운트돼 있고 하나만 보인다.
    warmUpReactDelegation();
    expect(mountSelectionPopups([true, false])).toBe(1);
  });
});

describe("usePdfAreaHighlight", () => {
  // 숨은 PDF가 keydown을 듣고 있으면, 사용자가 보고 있는 탭에서 Alt를 누를 때마다
  // 보이지 않는 문서가 영역 선택 모드로 들어간다.
  it("binds the Alt-tracking keys for an active surface", () => {
    warmUpReactDelegation();
    const { doc, win } = mountAreaHighlights([true]);
    expect(doc).toBe(1);
    expect(win).toBe(1);
  });

  it("binds nothing for surfaces mounted inactive", () => {
    warmUpReactDelegation();
    const { doc, win } = mountAreaHighlights([false, false]);
    expect(doc).toBe(0);
    expect(win).toBe(0);
  });

  it("binds once when one of two surfaces is visible", () => {
    warmUpReactDelegation();
    const { doc, win } = mountAreaHighlights([true, false]);
    expect(doc).toBe(1);
    expect(win).toBe(1);
  });
});
