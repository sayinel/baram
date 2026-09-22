// §367 `--color-*` 인라인의 작성자는 테마 적용 이펙트 **하나**다.
//
// 무엇이 이것을 실패시키는가: 다이얼이나 다른 이펙트가 `--color-*` 를 직접 쓰면
// 이 테스트가 그 값이 사라지는 것을 보여 준다. 그것이 `DialBase.channel` 이 있는
// 이유이고, 이 파일이 그 이유를 실행 가능한 형태로 붙잡아 둔다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `useSettingsEffects` 는 네이티브 메뉴 셋을 지연 `import()` 로 동기화한다(§82).
// 하나가 vitest 환경 해체 뒤에 착지하면 통과한 채로 런 전체가 깨진다
// (`use-settings-effects-theme-modes.test.tsx` 와 같은 목록·같은 이유).
const menuIpc = vi.hoisted(() => ({
  syncMenuEnabled: vi.fn(() => Promise.resolve()),
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../ipc/menu-locale", () => ({
  syncMenuLocale: menuIpc.syncMenuLocale,
}));
vi.mock("../../ipc/recent-menu", () => ({
  syncRecentMenu: menuIpc.syncRecentMenu,
}));
vi.mock("../../ipc/menu-enabled", () => ({
  syncMenuEnabled: menuIpc.syncMenuEnabled,
}));

import { useSettingsStore } from "../../stores/settings/store";
import { useSettingsEffects } from "../use-settings-effects";

function Host() {
  useSettingsEffects(null);
  return null;
}

describe("--color-* 인라인의 작성자", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    useSettingsStore.setState({ activeThemeId: "system" });
  });

  it("테마 이펙트가 아닌 곳이 쓴 --color-* 는 살아남지 못한다", () => {
    const root = document.documentElement;
    root.style.setProperty("--color-accent-default", "#ff0000");
    render(<Host />);
    // 실측(계획 작성 시점): 빈 문자열. `clearThemeVars` 가 무조건 지운다.
    expect(root.style.getPropertyValue("--color-accent-default")).toBe("");
  });

  // 비공허성: 위 단언은 `<html>` 의 style 이 통째로 비워져도 통과한다.
  // 이것이 그 설명을 배제한다 — 레이아웃 채널은 자기 규칙대로 남거나 지워진다.
  it("레이아웃 채널은 자기 규칙을 따른다", () => {
    const root = document.documentElement;
    render(<Host />);
    // 기본값이므로 `applyDialVars` 가 지운다(§364.2 희소성). 남아 있다면
    // 희소성이 깨진 것이고, 그것은 이 단언이 아니라 apply.test.ts 가 잡는다.
    expect(root.style.getPropertyValue("--editor-max-width")).toBe("");
  });
});
