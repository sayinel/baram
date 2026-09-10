// §352 — 2단 브라우저. 필터·그룹·미리보기.
//
// R11/R12: 컴포넌트 테스트는 raw i18n 키가 아니라 실제 번역 문자열을
// 단정한다(FontSlotPicker.test.tsx, KeybindingsTab.test.tsx와 같은 관례) —
// 기본 로케일이 "en"이므로 `t()`는 실제 영문을 돌려준다.
//
// R25: 세리프 판정이 없어(ttf-parser 0.25.1에 OS/2 family class 필드가 없다)
// serif/sans 칩과 그 필드를 뺀다 — SystemFont에는 애초에 `serif`가 없다.
import type { SystemFont } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { filterFonts, FontBrowser } from "../FontBrowser";

const font = (name: string, extra: Partial<SystemFont> = {}): SystemFont => ({
  hasKorean: false,
  monospaced: false,
  name,
  weights: [400],
  ...extra,
});

const FONTS = [
  font("Pretendard Variable", { hasKorean: true }),
  font("Noto Sans KR", { hasKorean: true }),
  font("D2Coding", { hasKorean: true, monospaced: true }),
  font("Georgia"),
  font("Montserrat"),
];

describe("filterFonts", () => {
  it("returns everything with no query and no chips", () => {
    expect(
      filterFonts(FONTS, { chips: [], query: "", slot: "body" }),
    ).toHaveLength(5);
  });

  it("matches the query case-insensitively on the family name", () => {
    const out = filterFonts(FONTS, { chips: [], query: "noto", slot: "body" });
    expect(out.map((f) => f.name)).toEqual(["Noto Sans KR"]);
  });

  it("narrows to Korean-capable families with the korean chip", () => {
    const out = filterFonts(FONTS, {
      chips: ["korean"],
      query: "",
      slot: "body",
    });
    expect(out.map((f) => f.name)).toEqual([
      "Pretendard Variable",
      "Noto Sans KR",
      "D2Coding",
    ]);
  });

  it("intersects multiple chips rather than unioning them", () => {
    const out = filterFonts(FONTS, {
      chips: ["korean", "mono"],
      query: "",
      slot: "body",
    });
    expect(out.map((f) => f.name)).toEqual(["D2Coding"]);
  });

  // 코드 슬롯은 고정폭으로 기본 필터된다 — 칩으로 해제할 수 있다.
  it("defaults the code slot to monospaced families", () => {
    const out = filterFonts(FONTS, { chips: [], query: "", slot: "code" });
    expect(out.map((f) => f.name)).toEqual(["D2Coding"]);
  });

  it("lets the code slot see proportional families once mono is deselected explicitly", () => {
    const out = filterFonts(FONTS, { chips: ["all"], query: "", slot: "code" });
    expect(out.length).toBe(5);
  });
});

describe("FontBrowser", () => {
  const props = { onClose: vi.fn(), slot: "body" as const };

  it("shows the filtered count against the total", () => {
    render(<FontBrowser {...props} fonts={FONTS} recentFonts={[]} />);
    expect(screen.getByTestId("font-browser-count").textContent).toContain("5");
  });

  it("groups included, recent, and installed families in that order", () => {
    render(<FontBrowser {...props} fonts={FONTS} recentFonts={["Georgia"]} />);
    const groups = screen
      .getAllByTestId("font-browser-group")
      .map((el) => el.textContent);
    expect(groups).toEqual(["Included", "Recent", "Installed"]);
  });

  it("omits the recent group when there is no history", () => {
    render(<FontBrowser {...props} fonts={FONTS} recentFonts={[]} />);
    const groups = screen
      .getAllByTestId("font-browser-group")
      .map((el) => el.textContent);
    expect(groups).not.toContain("Recent");
  });

  // 최근 사용은 슬롯별로 필터된다 — 코드 슬롯에 본문 서체를 권하지 않는다.
  it("filters the recent group by the slot", () => {
    render(
      <FontBrowser
        fonts={FONTS}
        onClose={vi.fn()}
        recentFonts={["Georgia", "D2Coding"]}
        slot="code"
      />,
    );
    const recent =
      screen.getByTestId("font-browser-recent-items").textContent ?? "";
    expect(recent).toContain("D2Coding");
    expect(recent).not.toContain("Georgia");
  });

  it("renders both slots in the preview so the pairing is visible", () => {
    render(<FontBrowser {...props} fonts={FONTS} recentFonts={[]} />);
    expect(screen.getByTestId("font-browser-preview-body")).toBeTruthy();
    expect(screen.getByTestId("font-browser-preview-code")).toBeTruthy();
  });

  // R28 — 2159개 얼굴 열거는 이 머신에서 250~270ms, 디스크 I/O 바운드다.
  // 목록 영역은 그 동안 정직하게 로딩을 라벨링한다(전체 스켈레톤 아님).
  it("shows a loading state in the list area while the enumeration is not known-good", () => {
    render(
      <FontBrowser
        fonts={null}
        onClose={vi.fn()}
        recentFonts={[]}
        slot="body"
      />,
    );
    expect(screen.getByTestId("font-browser-list-loading")).toBeTruthy();
  });
});
