// §356 테마 미리보기 그림 — 팔레트 계약(`theme-preview-palette.ts`)을 받아 그린다.
import type { PreviewPalette } from "../../../../themes/theme-preview-palette";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PREVIEW_COLOR_KEYS } from "../../../../themes/theme-preview-palette";
import { ThemePreview } from "../theme-preview";

/** 키마다 다른 색 — 어느 키가 어디 칠해졌는지 구별하려고. jsdom 이 `rgb()` 를 그대로
 *  직렬화하므로 hex 가 아니라 `rgb()` 로 적는다. */
function distinctPalette(offset: number): PreviewPalette {
  const out = {} as Record<(typeof PREVIEW_COLOR_KEYS)[number], string>;
  PREVIEW_COLOR_KEYS.forEach((key, i) => {
    out[key] = `rgb(${offset + i + 1}, 0, 0)`;
  });
  return out;
}

function stylesOf(el: Element): string {
  return [el, ...el.querySelectorAll("[style]")]
    .map((node) => node.getAttribute("style") ?? "")
    .join(";");
}

describe("ThemePreview", () => {
  it("그릴 팔레트가 없으면 아무것도 그리지 않는다", () => {
    const { container } = render(<ThemePreview palettes={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("장식이라 보조기기에서 숨긴다 — 카드 버튼의 이름에 더미 글이 섞이지 않게", () => {
    const { container } = render(
      <ThemePreview palettes={{ light: distinctPalette(0) }} />,
    );
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("모드가 하나면 칸 하나, 둘이면 라이트 · 다크 순서로 칸 둘", () => {
    const one = render(
      <ThemePreview palettes={{ dark: distinctPalette(0) }} />,
    );
    expect(
      [...one.container.querySelectorAll("[data-mode]")].map((el) =>
        el.getAttribute("data-mode"),
      ),
    ).toEqual(["dark"]);
    one.unmount();

    const two = render(
      <ThemePreview
        palettes={{ dark: distinctPalette(100), light: distinctPalette(0) }}
      />,
    );
    expect(
      [...two.container.querySelectorAll("[data-mode]")].map((el) =>
        el.getAttribute("data-mode"),
      ),
    ).toEqual(["light", "dark"]);
  });

  // 무엇이 이것을 실패시키는가: 계약에 있는 키를 그림이 칠하지 않으면. 그런 키는 레지스트리
  // 색인이 싣게 될 죽은 필드가 된다 — 계약과 그림이 같은 목록을 말해야 한다.
  it("계약의 키를 전부 칠한다", () => {
    const palette = distinctPalette(0);
    const { container } = render(
      <ThemePreview palettes={{ light: palette }} />,
    );
    const pane = container.querySelector('[data-mode="light"]');
    expect(pane).not.toBeNull();
    const styles = stylesOf(pane as Element);
    for (const key of PREVIEW_COLOR_KEYS) {
      expect(styles, key).toContain(palette[key]);
    }
  });

  it("각 칸은 제 모드의 팔레트로만 칠한다", () => {
    const light = distinctPalette(0);
    const dark = distinctPalette(100);
    const { container } = render(<ThemePreview palettes={{ dark, light }} />);
    const lightStyles = stylesOf(
      container.querySelector('[data-mode="light"]') as Element,
    );
    for (const key of PREVIEW_COLOR_KEYS) {
      expect(lightStyles).not.toContain(dark[key]);
    }
  });
});
