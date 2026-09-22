import type { InstalledTheme } from "../../themes/theme-install";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useAppearanceDials } from "../use-appearance-dials";

// ‼️ `vi.mock` 은 import 위로 호이스팅되므로 팩토리가 평범한 모듈 변수를 볼 수 없다
// — `plugin-lifecycle.errors.test.ts` 등이 같은 이유로 `vi.hoisted` 를 쓴다. 진짜
// 구현으로 그대로 넘기고 **횟수만** 센다: 아래 deps 테스트는 DOM 이 답할 수 없는
// 질문(같은 값을 다시 썼는가)을 묻기 때문이다.
const h = vi.hoisted(() => ({ applyCalls: 0 }));
vi.mock("../../appearance/apply", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../appearance/apply")>();
  return {
    ...actual,
    applyDialVars: (...args: Parameters<typeof actual.applyDialVars>) => {
      h.applyCalls += 1;
      actual.applyDialVars(...args);
    },
  };
});

/** `src/themes/__tests__/theme-revocation.test.ts` 의 픽스처 모양 + `dials`. */
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

describe("useAppearanceDials", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      activeThemeId: "system",
      appearanceOverrides: {},
      installedThemes: {},
    });
    document.documentElement.removeAttribute("style");
    h.applyCalls = 0;
  });

  it("writes nothing while every dial is at its default", () => {
    renderHook(() => useAppearanceDials());
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("writes the width variable once the user sets it", () => {
    const { rerender } = renderHook(() => useAppearanceDials());
    act(() => {
      useSettingsStore.getState().setDial("editorMaxWidth", 640);
    });
    rerender();
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("640px");
  });

  it("removes the variable again on reset", () => {
    const { rerender } = renderHook(() => useAppearanceDials());
    act(() => {
      useSettingsStore.getState().setDial("editorMaxWidth", 640);
    });
    rerender();
    act(() => {
      useSettingsStore.getState().resetDial("editorMaxWidth");
    });
    rerender();
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("");
  });

  it("§366 — an installed theme's dial reaches `<html>` with no user override", () => {
    // 무엇이 이것을 실패시키는가: 이 훅이 병합기에 빈 테마 층을 계속 넘기면
    // (0093 의 `NO_THEME_DIALS`) 이 변수는 영영 쓰이지 않는다. 스펙 §15 검증
    // 2번이 0093 에서 ❌ 였던 이유가 그것이다.
    useSettingsStore.setState({
      activeThemeId: "prose",
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    renderHook(() => useAppearanceDials());
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("720px");
  });

  it("§366 — the user layer still wins over the theme's proposal", () => {
    useSettingsStore.setState({
      activeThemeId: "prose",
      appearanceOverrides: { editorMaxWidth: 960 },
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    renderHook(() => useAppearanceDials());
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("960px");
  });

  it("§364.2 — a dial the theme did not mention emits no variable at all", () => {
    // 희소 유지. 무엇이 이것을 실패시키는가: 테마 층이 말하지 않은 다이얼까지
    // 채워 넣으면 기본 여백이 인라인으로 고정돼 cascade 를 이겨 버린다.
    useSettingsStore.setState({
      activeThemeId: "prose",
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    renderHook(() => useAppearanceDials());
    expect(
      document.documentElement.style.getPropertyValue("--editor-padding"),
    ).toBe("");
  });

  it("re-renders with nothing changed do not re-run the apply effect", () => {
    // 이펙트 deps 에 테마 층이 들어갔다(§366). 무엇이 이것을 실패시키는가:
    // `themeDialsFor` 가 렌더마다 새 객체를 돌려주면 이 카운트가 렌더 수만큼
    // 늘고, `<html>` 에 같은 값을 계속 다시 쓴다. DOM 으로는 물을 수 없는
    // 질문이라 타이밍이 아니라 **횟수**로 고정한다.
    useSettingsStore.setState({
      activeThemeId: "prose",
      installedThemes: { prose: installedTheme({ editorMaxWidth: 720 }) },
    });
    const { rerender } = renderHook(() => useAppearanceDials());
    const afterMount = h.applyCalls;
    rerender();
    rerender();
    rerender();
    expect(h.applyCalls).toBe(afterMount);
    // 비공허성: 실제로 바뀌면 다시 돈다.
    act(() => {
      useSettingsStore.getState().setDial("editorMaxWidth", 960);
    });
    rerender();
    expect(h.applyCalls).toBeGreaterThan(afterMount);
  });
});
