// §352 (Task 6) — the font browser replaces the placeholder this test
// originally pinned (§351 review Important 3: clicking "Browse…" must not
// blank the whole Editor settings tab with no way back). Updated to verify
// the real component: <FontBrowser/> owns its own back control the way
// AppearanceTab's <ThemeEditor/> does, and using it restores the tab's
// normal font rows.
import type { DialId } from "../../../appearance/dials";
import type { InstalledTheme } from "../../../themes/theme-install";

import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DIALS } from "../../../appearance/dials";
import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { useSettingsRegistry } from "../settings-registry";
import { AppearanceTab } from "../tabs/AppearanceTab";
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

/** `appearance-dial-row.test.tsx` 의 픽스처 그대로 — 활성 테마가 다이얼을 제안하게 한다. */
function installedTheme(
  dials: Record<string, number | string>,
): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "prose",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/prose",
    manifest: {
      author: "a",
      description: "d",
      dials,
      engines: { baram: ">=0.7.0" },
      id: "prose",
      license: "MIT",
      modes: { light: { tokens: "t.json" } },
      name: "prose",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
  };
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
      appearanceOverrides: { editorFontSize: 21, editorLineHeight: 1.7 },
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
    const back = screen.getByRole("button", { name: "Editor settings" });
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
      appearanceOverrides: { editorFontFamily: "Comic Sans MS" },
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
      appearanceOverrides: { editorFontSize: 20, editorLineHeight: 2 },
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
  //
  // §365 "보이던 값" 은 **병합된** 본문에서 파생한 값이고, 그것을 정하는 것은 스위치의
  // 호출부(`EditorTab.tsx` 가 `setLinkFontMetrics` 에 넘기는 본문 값)다. 그래서 본문 20 / 2 를
  // 사용자 층이 아니라 **테마 층**에 두고 실제 스위치를 누른다. 무엇이 이것을 실패시키는가:
  // 호출부가 기본값(16 / 1.75)을 넘기거나, 사용자 층만 보고 테마 층을 빠뜨리면(여기서는 빈 층 →
  // 역시 기본값) 코드 값이 14px / 1.75 로 적힌다.
  it("enables the code sliders at the values they were showing, once unlinked", async () => {
    useSettingsStore.setState({
      ...initialState,
      activeThemeId: "prose",
      appearanceOverrides: {},
      installedThemes: {
        prose: installedTheme({ editorFontSize: 20, editorLineHeight: 2 }),
      },
      linkFontMetrics: true,
      locale: "en",
    });
    await renderTab();
    // 테마 층이 이 탭에 실제로 닿았다 — 아니면 아래 18px 가 무엇을 증명하는지 알 수 없다.
    expect(parenthesised(/Size of text in the editor/u)).toBe("20px");

    const matchBody = screen
      .getByText("Match Body Text")
      .closest(".settings-row")
      ?.querySelector<HTMLElement>('[role="switch"]');
    expect(matchBody).toBeTruthy();
    act(() => {
      matchBody!.click();
    });

    expect(useSettingsStore.getState().linkFontMetrics).toBe(false);
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

  // §365 검색 결과의 연동 스위치도 같은 계약이다 — 그 호출부는 `settings-registry.ts` 의
  // `linkFontMetrics` 항목이 넘기는 `resolveEditorTypography(themeDials, …)` 다. 무엇이 이것을
  // 실패시키는가: 위 테스트와 같다(기본값을 넘기거나 테마 층을 빠뜨리면 14 / 1.75).
  it("seeds the code values from the merged body through the search entry's switch", () => {
    useSettingsStore.setState({
      ...initialState,
      activeThemeId: "prose",
      appearanceOverrides: {},
      installedThemes: {
        prose: installedTheme({ editorFontSize: 20, editorLineHeight: 2 }),
      },
      linkFontMetrics: true,
    });
    const { result } = renderHook(() => useSettingsRegistry());
    const entry = result.current.find((s) => s.id === "linkFontMetrics");
    expect(entry).toBeDefined();

    act(() => {
      entry!.control.storeSetter(false);
    });

    const s = useSettingsStore.getState();
    expect(s.linkFontMetrics).toBe(false);
    expect(s.codeFontSize).toBe(18); // Math.round(20 × 0.875 = 17.5)
    expect(s.codeLineHeight).toBe(2);
  });

  // 코드 슬롯의 예제는 코드 크기로 그린다 — 본문 크기로 그리면 실제 에디터에는
  // 없는 조합을 보여 주게 되고, 예제를 보는 이유가 사라진다.
  it("previews the code slot at the code size, not the body size", async () => {
    useSettingsStore.setState({
      ...initialState,
      appearanceOverrides: { editorFontSize: 20 },
      locale: "en",
    });
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
      useSettingsStore
        .getState()
        .setLinkFontMetrics(false, { fontSize: 16, lineHeight: 1.75 });
      useSettingsStore.getState().setDial("editorFontSize", 30);
    });
    expect(parenthesised(/Size of code text/u)).toBe("14px");
    expect(parenthesised(/Size of text in the editor/u)).toBe("30px");
  });
});

describe("EditorTab — 다이얼 행", () => {
  // §367 이 다이얼을 두 탭으로 갈랐다 — 레이아웃 다이얼(`channel: "layout"`)은
  // 여기 EditorTab에, 색 다이얼(`channel: "color"`, accentHueShift·
  // accentSaturationShift)은 AppearanceTab에 산다(그 파일 헤더 주석의 §365.4
  // 근거). 그래서 이 테스트는 둘을 함께 렌더링해 "다이얼을 소유한 탭에 행이
  // 있는가"를 본다 — "EditorTab 하나에 다 있는가"가 아니다.
  it("renders a row for every appearance dial in the tab that owns it", () => {
    // §368 이 실제로 물린 자리의 **반대 방향**이다. 그때는 행이 있고 레지스트리
    // 항목이 없어서 검색에서 사라졌다. 여기서 막는 것은 레지스트리 항목만 있고
    // 행이 없는 경우다 — 그러면 검색 결과를 눌러 온 사용자가 빈 탭을 본다.
    // 두 방향 모두 한쪽 표면만 보면 멀쩡해 보인다.
    //
    // 무엇이 이것을 실패시키는가: `DIALS` 에 다이얼을 더하고 그 채널이 사는 탭
    // (EditorTab 또는 AppearanceTab)에 `<AppearanceDialRow/>` 를 더하지 않으면
    // 실패한다. 기대 문자열을 손으로 적지 않고 레지스트리의 label 키 →
    // en.json 으로 **파생**시키는 이유는, 손으로 적으면 레지스트리와 행이 서로
    // 다른 키를 가리켜도 초록이기 때문이다.
    const { result } = renderHook(() => useSettingsRegistry());
    const labelKeyById = new Map(result.current.map((s) => [s.id, s.label]));
    render(<EditorTab />);
    render(<AppearanceTab />);

    // 계획 0107 Task 1 — `channel: "editor"` 넷(본문 타이포)의 id 는 레지스트리 항목의
    // id 와 **다르다**. 이 넷은 옮기기 전부터 있던 항목(`fontFamily`·`codeFontFamily`·
    // `fontSize`·`lineHeight`, `settings-registry.ts` 실측)을 그대로 물려받았고, 그
    // 항목의 행은 이미 EditorTab 에 있다(옮기기 전 설정 화면 그대로) — `AppearanceDialRow`
    // 가 아니라 이 넷을 그린다. 계획 0107 Task 3(h)가 "항목 id 는 그대로 — 검색 결과의
    // 안정된 키다" 라고 판정해 이후 어느 태스크도 그 id 를 다이얼 id 로 바꾸지 않으므로,
    // 건너뛰는 대신 아래 맵으로 옮겨 확인한다 — 맵의 키를 `DialId` 로 둬 오타(다이얼 id
    // 변경)가 나면 타입체크가 멎는다.
    const REGISTRY_ID_OVERRIDE: Partial<Record<DialId, string>> = {
      editorCodeFontFamily: "codeFontFamily",
      editorFontFamily: "fontFamily",
      editorFontSize: "fontSize",
      editorLineHeight: "lineHeight",
    };
    const missing = DIALS.map((d) => REGISTRY_ID_OVERRIDE[d.id] ?? d.id).filter(
      (id) => {
        const key = labelKeyById.get(id);
        if (key === undefined) return true;
        const text = (en as Record<string, string>)[key];
        if (text === undefined) return true;
        return screen.queryAllByText(text).length === 0;
      },
    );
    expect(missing).toEqual([]);
  });
});
