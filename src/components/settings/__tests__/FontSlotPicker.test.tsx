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

  // review Important 1 — the value name is the only remaining commit path.
  // Without it, a family absent from the enumeration could never be saved
  // (the free-text entry the old dropdown had was deleted with it).
  describe("click-to-edit commit path", () => {
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
      fireEvent.click(
        screen.getByRole("button", { name: "Pretendard Variable" }),
      );
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Roboto" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("Roboto");
      // Back to the read view — this component is controlled, so it shows
      // the (still-unchanged) `value` prop again until the parent re-renders
      // with the committed one, which is EditorTab's job, not this one's.
      expect(screen.queryByRole("textbox")).toBeNull();
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
      fireEvent.click(
        screen.getByRole("button", { name: "Pretendard Variable" }),
      );
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
      fireEvent.click(
        screen.getByRole("button", { name: "Pretendard Variable" }),
      );
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Whatever" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Pretendard Variable" }),
      ).toBeTruthy();
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
      fireEvent.click(
        screen.getByRole("button", { name: "Pretendard Variable" }),
      );
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
