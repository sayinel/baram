// §386 모드 행(스펙 0064 D2) — 언제 보이고, 무엇을 쓰는가.
import type { ThemeDef } from "../../../../types/theme";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { defaultColorsForBase } from "../../../../types/theme";
import { ColorModeRow } from "../color-mode-row";

const PAIRED: ThemeDef = {
  id: "custom-paired",
  modes: {
    dark: { colors: defaultColorsForBase("dark") },
    light: { colors: defaultColorsForBase("light") },
  },
  name: "Paired",
  source: "custom",
};

function modeSelect(): HTMLSelectElement | null {
  return screen.queryByRole<HTMLSelectElement>("combobox", { name: "Mode" });
}

beforeEach(() => {
  useSettingsStore.setState({
    activeThemeId: "system",
    colorModeSetting: "system",
    customThemes: [PAIRED],
    installedThemes: {},
    locale: "en",
  });
});

afterEach(() => {
  useSettingsStore.setState({
    activeThemeId: "system",
    colorModeSetting: "system",
    customThemes: [],
  });
});

describe("ColorModeRow (§386)", () => {
  it("Baram 기본(system)에서 보인다", () => {
    render(<ColorModeRow />);
    expect(modeSelect()).not.toBeNull();
  });

  it("두 모드 사용자 테마에서 보인다", () => {
    useSettingsStore.setState({ activeThemeId: PAIRED.id });
    render(<ColorModeRow />);
    expect(modeSelect()).not.toBeNull();
  });

  // 스펙 D2 — 해석되지 않는 id 는 적용 이펙트가 기본 팔레트 쌍으로 그린다.
  it("해석되지 않는 id 에서도 보인다", () => {
    useSettingsStore.setState({ activeThemeId: "custom-gone" });
    render(<ColorModeRow />);
    expect(modeSelect()).not.toBeNull();
  });

  // 무엇이 이것을 실패시키는가: 조건 없이 늘 그리는 구현 — 9장 중 8장에서 효과 없는 컨트롤.
  it("한 모드 테마(tokyo-night)에서는 숨는다", () => {
    useSettingsStore.setState({ activeThemeId: "tokyo-night" });
    render(<ColorModeRow />);
    expect(modeSelect()).toBeNull();
  });

  it("숨긴 동안 값은 남고, 따르는 테마로 돌아오면 그 값을 보인다", () => {
    useSettingsStore.setState({
      activeThemeId: "tokyo-night",
      colorModeSetting: "dark",
    });
    render(<ColorModeRow />);
    expect(modeSelect()).toBeNull();

    act(() => {
      useSettingsStore.setState({ activeThemeId: "system" });
    });
    expect(modeSelect()?.value).toBe("dark");
  });

  it("고르면 설정에 쓴다", () => {
    render(<ColorModeRow />);
    fireEvent.change(modeSelect()!, { target: { value: "light" } });
    expect(useSettingsStore.getState().colorModeSetting).toBe("light");
  });

  it("선택지는 시스템 · 라이트 · 다크 순이다", () => {
    render(<ColorModeRow />);
    const labels = Array.from(modeSelect()!.options).map((o) => o.text);
    expect(labels).toEqual(["System", "Light", "Dark"]);
  });
});
