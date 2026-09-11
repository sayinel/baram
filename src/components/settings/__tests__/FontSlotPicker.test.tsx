// §351 — 설정 행의 서체 피커.
//
// 이 컴포넌트가 없애는 결함(§346의 4): 기존 드롭다운은 각 행을
// style={{ fontFamily: name }} 로 그렸고, 없는 서체는 폴백으로 렌더돼서
// 무효한 항목 11개가 정상처럼 보였다. 배지가 그 사실을 말한다.
//
// R12: `t()` 는 이 저장소의 기본 로케일(en)로 실제 영문 문자열을 돌려준다 —
// 이 디렉터리의 다른 컴포넌트 테스트(GeneralTab.test.tsx, KeybindingsTab.test.tsx)와
// 같은 관례로, 키 문자열 자체가 아니라 번역된 문자열을 단정한다.
import type { SystemFont } from "../../../ipc/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { fontAvailability } from "../../../utils/font/font-availability";
import { FontSlotPicker } from "../FontSlotPicker";

const font = (name: string, extra: Partial<SystemFont> = {}): SystemFont => ({
  hasKorean: false,
  monospaced: false,
  name,
  weights: [400],
  ...extra,
});

/** 연필 버튼의 접근 가능한 이름 — 자유 입력의 유일한 입구다. */
const EDIT_LABEL = "Type a font name";

const INSTALLED = [
  font("Pretendard Variable"),
  font("Noto Sans KR", { hasKorean: true }),
  font("D2Coding", { hasKorean: true, monospaced: true }),
];

describe("fontAvailability", () => {
  it("reports a bundled family as bundled even though it is also installed", () => {
    expect(fontAvailability("Pretendard Variable", INSTALLED)).toBe("bundled");
  });

  it("reports an installed non-bundled family as system", () => {
    expect(fontAvailability("Noto Sans KR", INSTALLED)).toBe("system");
  });

  // 이것이 §346의 4를 끝내는 판정이다.
  it("reports a family absent from the enumeration as missing", () => {
    expect(fontAvailability("Roboto", INSTALLED)).toBe("missing");
  });

  it("matches case-insensitively", () => {
    expect(fontAvailability("noto sans kr", INSTALLED)).toBe("system");
  });

  it("treats an empty value as bundled — it means the default stack", () => {
    expect(fontAvailability("", INSTALLED)).toBe("bundled");
  });

  // review Critical 1 — a `null` enumeration means "not known good yet"
  // (still loading, or listFonts() fell back), not "checked and absent".
  it("reports unknown when the enumeration is not known-good, even for an installed-looking name", () => {
    expect(fontAvailability("Noto Sans KR", null)).toBe("unknown");
  });

  it("still reports bundled and empty-as-bundled when the enumeration is unknown", () => {
    expect(fontAvailability("Pretendard Variable", null)).toBe("bundled");
    expect(fontAvailability("", null)).toBe("bundled");
  });

  // review Important 2 (generics half) — a CSS generic keyword is not a font
  // this machine has or lacks; badging it "system" (as the old fallback-list
  // reachable path did) or "missing" is false either way.
  it.each(["serif", "monospace", "system-ui"])(
    "reports the CSS generic %s as unknown rather than system or missing",
    (generic) => {
      expect(fontAvailability(generic, INSTALLED)).toBe("unknown");
    },
  );
});

describe("FontSlotPicker", () => {
  const props = {
    fonts: INSTALLED,
    fontSize: 16,
    lineHeight: 1.75,
    onChange: vi.fn(),
    onOpenBrowser: vi.fn(),
  };

  it("labels a missing family so the user learns why nothing changed", () => {
    render(<FontSlotPicker {...props} slot="body" value="Roboto" />);
    expect(screen.getByText("Not on this machine")).toBeTruthy();
  });

  it("labels a bundled family as provided by the app", () => {
    render(
      <FontSlotPicker {...props} slot="body" value="Pretendard Variable" />,
    );
    expect(screen.getByText("Included")).toBeTruthy();
  });

  it("labels an installed Korean-capable family with the Korean marker", () => {
    render(<FontSlotPicker {...props} slot="body" value="Noto Sans KR" />);
    expect(screen.getByText("System · Korean")).toBeTruthy();
  });

  // review Critical 1 — the not-yet-known state must not claim a family is
  // missing (the very false statement §351 exists to end).
  it("renders no availability badge while the enumeration is not yet known", () => {
    render(
      <FontSlotPicker
        {...props}
        fonts={null}
        slot="body"
        value="Noto Sans KR"
      />,
    );
    expect(screen.queryByText("Not on this machine")).toBeNull();
    expect(screen.queryByText("Included")).toBeNull();
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByText("System · Korean")).toBeNull();
  });

  it("renders the preview strip in the selected family", () => {
    render(<FontSlotPicker {...props} slot="body" value="Noto Sans KR" />);
    const strip = screen.getByTestId("font-preview-strip");
    expect(strip.style.fontFamily).toContain("Noto Sans KR");
  });

  // 동훈님 요청 — 같은 화면의 크기·줄높이 슬라이더를 움직이면 예제도 따라
  // 움직여야 한다. 스트립이 고정 `rem` 이던 동안에는 무엇을 조절해도 예제는
  // 가만히 있었고, 그 설정이 본문에 어떻게 보일지는 창을 닫아야 알 수 있었다.
  it("renders the strip at the configured size and line height", () => {
    render(
      <FontSlotPicker
        {...props}
        fontSize={21}
        lineHeight={1.7}
        slot="body"
        value="Noto Sans KR"
      />,
    );
    const strip = screen.getByTestId("font-preview-strip");
    expect(strip.style.fontSize).toBe("21px");
    expect(strip.style.lineHeight).toBe("1.7");
  });

  // 세 줄이 `em` 이라야 위 인라인 크기에서 파생된다 — `rem` 이면 스트립의
  // 크기를 바꿔도 줄들은 루트 크기를 계속 읽어서 혼자 움직이지 않는다.
  // jsdom 은 `var()`/상속을 계산하지 않으므로 계산된 px 을 물을 수 없다:
  // 물을 수 있는 것은 선언된 단위다.
  it("sizes the three sample lines relative to the strip, not to the root", () => {
    const css = readFileSync("src/styles/settings/model.css", "utf8");
    for (const selector of [
      ".settings-font-strip-primary",
      ".settings-font-strip-secondary",
      ".settings-font-strip-glyphs",
    ]) {
      const body = new RegExp(`\\${selector} \\{([^}]*)\\}`, "u").exec(
        css,
      )?.[1];
      expect(body).toBeDefined();
      expect(body).toMatch(/font-size:\s*[\d.]+em;/u);
    }
  });

  // 글리프 줄은 두 슬롯 모두에 있다 — 본문에서도 숫자·유사문자 구분이 판단 근거다.
  it.each(["body", "code"] as const)(
    "shows the glyph line for the %s slot",
    (slot) => {
      render(<FontSlotPicker {...props} slot={slot} value="Noto Sans KR" />);
      expect(screen.getByTestId("font-preview-glyphs")).toBeTruthy();
    },
  );

  it("uses a code sample for the code slot and prose for the body slot", () => {
    const { unmount } = render(
      <FontSlotPicker {...props} slot="code" value="D2Coding" />,
    );
    expect(screen.getByTestId("font-preview-strip").textContent).toContain(
      "const",
    );
    unmount();
    render(<FontSlotPicker {...props} slot="body" value="Noto Sans KR" />);
    expect(screen.getByTestId("font-preview-strip").textContent).not.toContain(
      "const",
    );
  });

  // 동훈님 보고 — 눈이 먼저 가는 곳은 "더 보기"가 아니라 지금 쓰는 서체 이름이다.
  it("opens the browser when the font name itself is pressed", () => {
    const onOpenBrowser = vi.fn();
    render(
      <FontSlotPicker
        {...props}
        onOpenBrowser={onOpenBrowser}
        slot="code"
        value="D2Coding"
      />,
    );
    screen.getByRole("button", { name: "D2Coding" }).click();
    expect(onOpenBrowser).toHaveBeenCalledWith("code");
    // 그리고 편집으로 들어가지 않는다 — 한 클릭이 두 곳으로 가면 어느 쪽도 못 믿는다.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens the free-text input from its own button, not from the name", () => {
    const onOpenBrowser = vi.fn();
    render(
      <FontSlotPicker
        {...props}
        onOpenBrowser={onOpenBrowser}
        slot="body"
        value="Noto Sans KR"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: EDIT_LABEL }));
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(onOpenBrowser).not.toHaveBeenCalled();
  });

  it("opens the browser when the more button is pressed", async () => {
    const onOpenBrowser = vi.fn();
    render(
      <FontSlotPicker
        {...props}
        onOpenBrowser={onOpenBrowser}
        slot="body"
        value=""
      />,
    );
    screen.getByRole("button", { name: "Browse…" }).click();
    expect(onOpenBrowser).toHaveBeenCalledWith("body");
  });

  // review Important 1 — free text is the only remaining commit path. Without
  // it, a family absent from the enumeration could never be saved (the entry
  // the old dropdown had was deleted with it).
  //
  // 그 입구가 값 이름에서 연필 버튼으로 옮겨졌다: 이름을 누르는 것은 이제
  // 브라우저를 여는 동작이다(동훈님 보고 — 직관적으로 먼저 누르게 되는 곳).
  // 두 동작을 한 클릭에 겹칠 수는 없으므로 자유 입력은 자기 버튼을 갖는다.
  describe("free-text commit path", () => {
    it("commits a typed family name on Enter, including one absent from the enumeration", () => {
      const onChange = vi.fn();
      render(
        <FontSlotPicker
          {...props}
          onChange={onChange}
          slot="body"
          value="Pretendard Variable"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: EDIT_LABEL }));
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Roboto" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("Roboto");
      // Back to the read view — this component is controlled, so it shows
      // the (still-unchanged) `value` prop again until the parent re-renders
      // with the committed one, which is EditorTab's job, not this one's.
      expect(screen.queryByRole("textbox")).toBeNull();
      // review fix round 2 — REMOVED, not merely hidden: `queryByRole`
      // above would also pass for a `display: none` input (RTL excludes
      // hidden elements from accessibility queries), which would silently
      // reopen the unreachable blur race the comment at commit/cancel in
      // FontSlotPicker.tsx explains. This is the precondition that argument
      // actually depends on.
      expect(document.body.contains(input)).toBe(false);
    });

    it("commits on blur too", () => {
      const onChange = vi.fn();
      render(
        <FontSlotPicker
          {...props}
          onChange={onChange}
          slot="body"
          value="Pretendard Variable"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: EDIT_LABEL }));
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Georgia" } });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith("Georgia");
    });

    it("discards the edit on Escape without calling onChange", () => {
      const onChange = vi.fn();
      render(
        <FontSlotPicker
          {...props}
          onChange={onChange}
          slot="body"
          value="Pretendard Variable"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: EDIT_LABEL }));
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Whatever" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Pretendard Variable" }),
      ).toBeTruthy();
      // review fix round 2 — REMOVED, not merely hidden (see the matching
      // assertion on the Enter path above for why this specific check, not
      // queryByRole, is the one that guards the unreachable-blur-race
      // invariant explained at commit/cancel in FontSlotPicker.tsx).
      expect(document.body.contains(input)).toBe(false);
    });

    it("does not call onChange when the committed text equals the current value", () => {
      const onChange = vi.fn();
      render(
        <FontSlotPicker
          {...props}
          onChange={onChange}
          slot="body"
          value="Pretendard Variable"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: EDIT_LABEL }));
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
