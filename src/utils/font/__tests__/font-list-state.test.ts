// §350/§352 — 열거 상태가 셋인 이유, 그리고 `fallback` 이 어느 쪽으로 행동하는지.
//
// 이 파일이 지키는 것은 값이 아니라 **판단**이다: 폴백 목록은 "그릴 재료"로는
// 쓰고 "이 머신에 없음"의 근거로는 쓰지 않는다. 그 둘이 같은 `null` 이었던
// 동안 열거 실패는 영구 로딩 화면이 됐다 (final review I3).
import type { SystemFont } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { badgeFonts, fontListStateFrom } from "../font-list-state";

const FONTS: SystemFont[] = [
  { hasKorean: false, monospaced: false, name: "Georgia", weights: [400] },
];

describe("fontListStateFrom", () => {
  it("keeps a real enumeration as ok, with its list", () => {
    expect(fontListStateFrom({ fonts: FONTS, isFallback: false })).toEqual({
      fonts: FONTS,
      status: "ok",
    });
  });

  // ‼️ The list survives. A fallback that dropped its fonts would be
  // indistinguishable from loading again, which is the whole defect.
  it("keeps a fallback as fallback, WITH its list to render", () => {
    expect(fontListStateFrom({ fonts: FONTS, isFallback: true })).toEqual({
      fonts: FONTS,
      status: "fallback",
    });
  });
});

describe("badgeFonts", () => {
  it("hands over the list only for a real enumeration", () => {
    expect(badgeFonts({ fonts: FONTS, status: "ok" })).toBe(FONTS);
  });

  // Both non-authoritative states answer identically — that is the ruling.
  it.each(["fallback", "loading"] as const)(
    "answers null for %s, so no availability claim can be made",
    (status) => {
      const state =
        status === "loading"
          ? ({ status } as const)
          : ({ fonts: FONTS, status } as const);
      expect(badgeFonts(state)).toBeNull();
    },
  );
});
