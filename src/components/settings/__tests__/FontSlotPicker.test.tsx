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

import { render, screen } from "@testing-library/react";
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
});
