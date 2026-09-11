// §352 — 2단 브라우저. 필터·그룹·미리보기.
//
// R11/R12: 컴포넌트 테스트는 raw i18n 키가 아니라 실제 번역 문자열을
// 단정한다(FontSlotPicker.test.tsx, KeybindingsTab.test.tsx와 같은 관례) —
// 기본 로케일이 "en"이므로 `t()`는 실제 영문을 돌려준다.
//
// R25: 세리프 판정이 없어(ttf-parser 0.25.1에 OS/2 family class 필드가 없다)
// serif/sans 칩과 그 필드를 뺀다 — SystemFont에는 애초에 `serif`가 없다.
import type { SystemFont } from "../../../ipc/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
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

/** 권위 있는 열거 — 아래 대부분의 케이스가 쓰는 상태. */
const OK = { fonts: FONTS, status: "ok" } as const;

describe("FontBrowser", () => {
  const props = { onClose: vi.fn(), slot: "body" as const };

  const settingsBefore = useSettingsStore.getState();
  afterEach(() => {
    useSettingsStore.setState(settingsBefore, true);
  });

  it("shows the filtered count against the total", () => {
    render(<FontBrowser {...props} recentFonts={[]} state={OK} />);
    expect(screen.getByTestId("font-browser-count").textContent).toContain("5");
  });

  it("groups included, recent, and installed families in that order", () => {
    render(<FontBrowser {...props} recentFonts={["Georgia"]} state={OK} />);
    const groups = screen
      .getAllByTestId("font-browser-group")
      .map((el) => el.textContent);
    expect(groups).toEqual(["Included", "Recent", "Installed"]);
  });

  // 동훈님 보고 — 서체를 하나 고를 때마다 그 줄이 "설치된 서체"에서 사라져
  // "최근 사용"으로 이사를 갔다. 바로 아래 줄을 이어서 눌러 보려던 손은 매번
  // 어긋난다. 최근 사용은 바로가기이지 이사가 아니다: 원래 자리는 그대로 두고
  // 위에 한 벌 더 보여준다.
  it("keeps a recent family in the installed group instead of moving it", () => {
    render(<FontBrowser {...props} recentFonts={["Georgia"]} state={OK} />);
    expect(
      screen.getByTestId("font-browser-recent-items").textContent,
    ).toContain("Georgia");
    expect(
      screen.getByTestId("font-browser-installed-items").textContent,
    ).toContain("Georgia");
  });

  // 위보다 강한 판정 — "목록이 흔들리지 않는다"는 주장은 한 이름이 남아 있다는
  // 것이 아니라 목록 전체가 그대로라는 것이다. 이름 하나만 보는 단정은 그 이름을
  // 예외 처리하는 구현으로도 초록이 되고, 그러면 그 다음 선택에서 다시 흔들린다.
  it("leaves the installed list unchanged when a pick lands in recents", () => {
    const { rerender } = render(
      <FontBrowser {...props} recentFonts={[]} state={OK} />,
    );
    const before = screen.getByTestId(
      "font-browser-installed-items",
    ).textContent;
    rerender(<FontBrowser {...props} recentFonts={["Georgia"]} state={OK} />);
    expect(screen.getByTestId("font-browser-installed-items").textContent).toBe(
      before,
    );
  });

  // §354 — 미리보기의 용도가 "본문과 코드가 나란히 있을 때 어떻게 보이는가"
  // 이므로 코드 칸은 코드 크기로 그려야 한다. 본문 크기로 그리면 실제 에디터에
  // 없는 조합을 보여 준다.
  it("draws the code sample at the code size, not the body size", () => {
    useSettingsStore.setState({ fontSize: 20, linkFontMetrics: true });
    render(<FontBrowser {...props} recentFonts={[]} state={OK} />);
    expect(screen.getByTestId("font-browser-preview-body").style.fontSize).toBe(
      "20px",
    );
    expect(screen.getByTestId("font-browser-preview-code").style.fontSize).toBe(
      "17.5px",
    );
  });

  it("omits the recent group when there is no history", () => {
    render(<FontBrowser {...props} recentFonts={[]} state={OK} />);
    const groups = screen
      .getAllByTestId("font-browser-group")
      .map((el) => el.textContent);
    expect(groups).not.toContain("Recent");
  });

  // 최근 사용은 슬롯별로 필터된다 — 코드 슬롯에 본문 서체를 권하지 않는다.
  it("filters the recent group by the slot", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={["Georgia", "D2Coding"]}
        slot="code"
        state={OK}
      />,
    );
    const recent =
      screen.getByTestId("font-browser-recent-items").textContent ?? "";
    expect(recent).toContain("D2Coding");
    expect(recent).not.toContain("Georgia");
  });

  // fix round 1, Important 1 — chips must narrow all three groups, not just
  // Included and Installed. Before the fix, Recent ignored `chips` entirely.
  it("narrows the recent group when a chip is pressed, not just Included and Installed", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={["Noto Sans KR", "Montserrat"]}
        slot="body"
        state={OK}
      />,
    );
    let recent =
      screen.getByTestId("font-browser-recent-items").textContent ?? "";
    expect(recent).toContain("Noto Sans KR");
    expect(recent).toContain("Montserrat");

    fireEvent.click(screen.getByRole("button", { name: "Korean" }));

    recent = screen.getByTestId("font-browser-recent-items").textContent ?? "";
    expect(recent).toContain("Noto Sans KR");
    expect(recent).not.toContain("Montserrat");
  });

  // fix round 1, Important 1 — the code slot's "all" escape hatch (pressing
  // the Monospace chip again, since it starts implicitly active there) must
  // lift the monospace default in Recent too, matching Installed.
  it("lets the code slot's all chip lift the monospace default in Recent too", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={["Georgia", "D2Coding"]}
        slot="code"
        state={OK}
      />,
    );
    expect(
      screen.getByTestId("font-browser-recent-items").textContent,
    ).not.toContain("Georgia");

    fireEvent.click(screen.getByRole("button", { name: "Monospace" }));

    const recent =
      screen.getByTestId("font-browser-recent-items").textContent ?? "";
    expect(recent).toContain("Georgia");
    expect(recent).toContain("D2Coding");
  });

  // controller ruling — a stale recent entry (chosen before, no longer on
  // this machine) must not be presented as selectable-and-fine. Excluded
  // from Recent once the enumeration is known-good, rather than badged.
  it("excludes a stale recent entry no longer found on this machine", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={["Comic Sans MS", "D2Coding"]}
        slot="body"
        state={OK}
      />,
    );
    const recent =
      screen.getByTestId("font-browser-recent-items").textContent ?? "";
    expect(recent).toContain("D2Coding");
    expect(recent).not.toContain("Comic Sans MS");
  });

  it("renders both slots in the preview so the pairing is visible", () => {
    render(<FontBrowser {...props} recentFonts={[]} state={OK} />);
    expect(screen.getByTestId("font-browser-preview-body")).toBeTruthy();
    expect(screen.getByTestId("font-browser-preview-code")).toBeTruthy();
  });

  // R28 — 2159개 얼굴 열거는 이 머신에서 250~270ms, 디스크 I/O 바운드다.
  // 목록 영역은 그 동안 정직하게 로딩을 라벨링한다(전체 스켈레톤 아님).
  it("shows a loading state in the list area while the enumeration has not resolved", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={[]}
        slot="body"
        state={{ status: "loading" }}
      />,
    );
    expect(screen.getByTestId("font-browser-list-loading")).toBeTruthy();
  });

  // ‼️ final review I3 — this case is why the state has three members. It used
  // to share `loading`'s pane, so a machine whose fonts could not be read said
  // "Loading fonts…" forever and FALLBACK_FONTS reached no surface at all,
  // while §350 required that the picker never be empty. The old two-state
  // shape could not satisfy that AND the badge's refusal to claim "missing"
  // from an untrustworthy list; three states satisfy both.
  it("renders the fallback rows with a notice instead of claiming to still be loading", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={[]}
        slot="body"
        state={{ fonts: FONTS, status: "fallback" }}
      />,
    );

    expect(screen.queryByTestId("font-browser-list-loading")).toBeNull();
    expect(screen.getByTestId("font-browser-list-fallback").textContent).toBe(
      "Couldn't read this machine's fonts — showing the bundled families.",
    );
    // The rows are there: the picker is not empty, which is the requirement.
    expect(screen.getAllByTestId("font-browser-group").length).toBeGreaterThan(
      0,
    );
    // And no count, which would read as "this machine has 5 fonts".
    expect(screen.getByTestId("font-browser-count").textContent).toBe("");
  });

  // 폴백 목록은 "이 머신에 무엇이 없는지"에 대한 권위가 아니다 — 그것으로
  // 최근 항목을 걸러 내면 실제로 설치된 서체를 이력에서 지운다.
  it("keeps a recent entry the fallback list does not mention", () => {
    render(
      <FontBrowser
        onClose={vi.fn()}
        recentFonts={["Comic Sans MS"]}
        slot="body"
        state={{ fonts: FONTS, status: "fallback" }}
      />,
    );
    expect(
      screen.getByTestId("font-browser-recent-items").textContent,
    ).toContain("Comic Sans MS");
  });
});
