// §351 · 스펙 0060 §7.2 — 입고 있는 테마의 CSS 가 선언한 서체 패밀리.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { DEFAULT_LIGHT_PALETTE } from "../../types/generated/palette-light";
import { useThemeFontFamilies } from "../use-theme-font-families";

const FACE =
  '@font-face{font-family:"Mine Serif";src:url(data:font/woff2;base64,AA==)}';

beforeEach(() => {
  usePluginStore.setState({ revocations: null });
  useSettingsStore.setState({
    activeThemeId: "mine",
    customThemes: [
      {
        id: "mine",
        modes: { light: { colors: DEFAULT_LIGHT_PALETTE, css: FACE } },
        name: "Mine",
        source: "custom",
      },
    ],
    installedThemes: {},
  });
});

describe("useThemeFontFamilies", () => {
  it("입고 있는 테마의 @font-face 패밀리(소문자)", () => {
    const { result } = renderHook(() => useThemeFontFamilies());
    expect([...result.current]).toEqual(["mine serif"]);
  });

  // 무엇이 이것을 실패시키는가: 고른 테마가 아니라 목록 전체의 CSS 를 훑으면 입지 않은 테마의
  // 서체가 "테마 제공" 으로 보인다.
  it("입지 않은 테마의 서체는 없다", () => {
    useSettingsStore.setState({ activeThemeId: "system" });
    const { result } = renderHook(() => useThemeFontFamilies());
    expect(result.current.size).toBe(0);
  });
});
