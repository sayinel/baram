// §352 (Task 6) — the font browser replaces the placeholder this test
// originally pinned (§351 review Important 3: clicking "Browse…" must not
// blank the whole Editor settings tab with no way back). Updated to verify
// the real component: <FontBrowser/> owns its own back control the way
// AppearanceTab's <ThemeEditor/> does, and using it restores the tab's
// normal font rows.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { EditorTab } from "../tabs/EditorTab";

const initialState = useSettingsStore.getState();

afterEach(() => {
  useSettingsStore.setState(initialState, true);
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 설명문 괄호 안의 수치. 기대값을 손으로 적는 대신 화면에서 뽑는다 — 손으로
 *  적으면 두 표면이 함께 틀려도 초록이다. */
function parenthesised(pattern: RegExp): string {
  const text = screen.getByText(pattern).textContent ?? "";
  const inside = /\(([^)]+)\)/u.exec(text);
  expect(inside).not.toBeNull();
  return (inside as RegExpExecArray)[1];
}

describe("EditorTab — Browse…", () => {
  // 동훈님 요청 — 브라우저의 슬라이더에도 수치를 띄운다. 두 표면은 한 store 값의
  // 두 창이므로, 같은 값을 다른 모양으로 적으면(1.7 vs 1.70) 어느 쪽이 진짜인지
  // 알 수 없다. 그래서 단정은 "숫자가 보인다"가 아니라 "설정 행이 적은 것과 글자
  // 그대로 같다" 이고, 기대값을 손으로 적지 않고 설정 행에서 뽑아 온다 — 손으로
  // 적으면 두 표면이 함께 틀려도 초록이다.
  //
  // `1.7` 을 고른 이유: 자릿수 고정을 실제로 구분한다. `String(lineHeight)` 로
  // 되돌아가면 설정 행의 "1.70" 과 브라우저의 "1.7" 이 갈라져 이 테스트가 깨진다.
  it("shows the same size and line height in the browser as in the settings rows", async () => {
    useSettingsStore.setState({
      ...initialState,
      fontSize: 21,
      lineHeight: 1.7,
      locale: "en",
    });
    render(<EditorTab />);
    await flush();

    const size = parenthesised(/Size of text in the editor/u);
    const height = parenthesised(/^Spacing between lines \(/u);
    expect(size).toBe("21px");
    expect(height).toBe("1.70");

    act(() => {
      screen.getAllByRole("button", { name: "Browse…" })[0].click();
    });

    expect(screen.getByTestId("font-browser-size-value").textContent).toBe(
      size,
    );
    expect(
      screen.getByTestId("font-browser-line-height-value").textContent,
    ).toBe(height);
  });

  it("swaps in the font browser instead of a blank pane, and returns to the font rows", async () => {
    useSettingsStore.setState({ ...initialState, locale: "en" });
    render(<EditorTab />);
    await flush();

    const [browse] = screen.getAllByRole("button", { name: "Browse…" });
    act(() => {
      browse.click();
    });

    // Not blank: the browser's own chrome (back control, slot segment) is on
    // screen, and the tab's normal font rows are gone while it is up.
    const back = screen.getByRole("button", { name: "← Editor settings" });
    expect(screen.getByRole("button", { name: "Body" })).toBeTruthy();
    expect(screen.queryByText("Font Family")).toBeNull();

    act(() => {
      back.click();
    });

    expect(screen.getByText("Font Family")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Body" })).toBeNull();
  });

  // ‼️ final review I3, at the artifact rather than at a prop. The test
  // environment's `invoke` mock answers `font_list` with `undefined`, so
  // `listFonts()` really does take its fallback path here — the same state a
  // machine whose fonts cannot be enumerated is in. It used to reach this tab
  // as the identical `null` that "still loading" produced, and the browser
  // then said "Loading fonts…" with nothing behind it, for good.
  //
  // Note what this cannot be replaced by: a unit test on `listFonts` passes
  // today and did while this was broken — `FALLBACK_FONTS` satisfied its own
  // test and no surface. The claim has to be checked where the user is.
  it("shows the fallback list, not a permanent loading pane, when the enumeration falls back", async () => {
    useSettingsStore.setState({ ...initialState, locale: "en" });
    render(<EditorTab />);
    await flush();

    const [browse] = screen.getAllByRole("button", { name: "Browse…" });
    act(() => {
      browse.click();
    });

    expect(screen.queryByTestId("font-browser-list-loading")).toBeNull();
    expect(screen.getByTestId("font-browser-list-fallback")).toBeTruthy();
    // FALLBACK_FONTS reaches a surface — the bundled body face is offered.
    expect(
      screen.getAllByRole("button", { name: "Pretendard Variable" }).length,
    ).toBeGreaterThan(0);
  });

  // The other half of the three-state ruling, and the half the browser's own
  // fix must not cost: a fallback list is not authority for "this machine does
  // not have it". Claiming that about an installed font is the lie §351's badge
  // was built to end, so `fallback` must reach the badge as `null`.
  it("makes no missing claim about a chosen font while the enumeration is a fallback", async () => {
    useSettingsStore.setState({
      ...initialState,
      fontFamily: "Comic Sans MS",
      locale: "en",
    });
    render(<EditorTab />);
    await flush();

    // Non-vacuous: the value is on screen, so a badge for it would be too.
    expect(
      screen.getAllByRole("button", { name: "Comic Sans MS" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Not on this machine")).toBeNull();
  });
});

// §354 — 코드 크기·줄 높이를 따로 정할 수 있게 하되, 기본은 본문 연동이다.
describe("EditorTab — code metrics", () => {
  async function renderTab(): Promise<void> {
    render(<EditorTab />);
    await flush();
  }

  // 행을 숨기지 않고 끈 채로 두는 것이 이 설계의 선택이다 — 코드가 지금 몇 px
  // 인지는 연동 여부와 무관하게 궁금한 값이고, 행이 사라지면 "어디서 바꾸지?"
  // 가 된다. 단정이 "보인다"와 "끈 상태다" 둘 다인 이유가 그것이다.
  it("shows the code rows disabled, at the derived values, while linked", async () => {
    useSettingsStore.setState({
      ...initialState,
      fontSize: 20,
      lineHeight: 2,
      locale: "en",
    });
    await renderTab();

    expect(parenthesised(/Size of code text/u)).toBe("18px");
    expect(parenthesised(/Spacing between lines in code blocks/u)).toBe("2.00");
    for (const slider of screen.getAllByRole("slider")) {
      const row = slider.closest(".settings-row");
      const label = row?.textContent ?? "";
      if (label.includes("Code")) {
        expect((slider as HTMLInputElement).disabled).toBe(true);
      }
    }
  });

  // 연동을 끄면 슬라이더가 살아나고, 그 출발점은 방금까지 보이던 값이다 —
  // 다른 값에서 출발하면 스위치를 누른 것만으로 화면이 바뀐다.
  it("enables the code sliders at the values they were showing, once unlinked", async () => {
    useSettingsStore.setState({
      ...initialState,
      fontSize: 20,
      lineHeight: 2,
      locale: "en",
    });
    await renderTab();

    act(() => {
      useSettingsStore.getState().setLinkFontMetrics(false);
    });

    expect(parenthesised(/Size of code text/u)).toBe("18px");
    expect(parenthesised(/Spacing between lines in code blocks/u)).toBe("2.00");
    const codeSliders = screen
      .getAllByRole("slider")
      .filter((s) =>
        (s.closest(".settings-row")?.textContent ?? "").includes("Code"),
      );
    expect(codeSliders.length).toBe(2);
    for (const slider of codeSliders) {
      expect((slider as HTMLInputElement).disabled).toBe(false);
    }
  });

  // 코드 슬롯의 예제는 코드 크기로 그린다 — 본문 크기로 그리면 실제 에디터에는
  // 없는 조합을 보여 주게 되고, 예제를 보는 이유가 사라진다.
  it("previews the code slot at the code size, not the body size", async () => {
    useSettingsStore.setState({ ...initialState, fontSize: 20, locale: "en" });
    await renderTab();
    const strips = screen.getAllByTestId("font-preview-strip");
    expect(strips).toHaveLength(2);
    expect(strips[0].style.fontSize).toBe("20px");
    expect(strips[1].style.fontSize).toBe("17.5px");
  });

  // 끊어 둔 뒤에는 본문을 움직여도 코드가 따라가지 않는다 — 그것이 "각각
  // 설정한다" 의 전부다.
  it("stops following the body once unlinked", async () => {
    useSettingsStore.setState({ ...initialState, locale: "en" });
    await renderTab();
    act(() => {
      useSettingsStore.getState().setLinkFontMetrics(false);
      useSettingsStore.getState().setFontSize(30);
    });
    expect(parenthesised(/Size of code text/u)).toBe("14px");
    expect(parenthesised(/Size of text in the editor/u)).toBe("30px");
  });
});
