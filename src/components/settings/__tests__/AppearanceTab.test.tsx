// issue 523 — deleting a custom theme asks first.
//
// It is persisted data the user built by hand (a palette of 24 colours), and
// it used to be removed by one click on a small × overlaid on the card, with
// no way back. The file tree already confirms far less final deletions (a
// move to the trash) through the shared showConfirm dialog; the settings card
// now uses the same one. The dialog itself is mocked here — what is pinned is
// that the store does not change until it answers yes, and that the question
// names the item.
//
// The perspective-deletion sibling of this test, and the §338/I-8 preset
// feature-gate tests, moved to `tabs/__tests__/workspace-presets.test.tsx`
// when task-5 (§370) moved the workspace-presets section out of this tab.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => undefined),
  showConfirm: vi.fn(async () => false),
}));

// §361 — ThemeBrowser's own fetch is exercised in ThemeBrowser.test.tsx; here it only needs
// to resolve to SOMETHING so a "테마 찾아보기" routing test does not hang on a real IPC call.
vi.mock("../../../plugins/registry-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../plugins/registry-client")
  >()),
  fetchRegistryIndex: vi.fn(() => Promise.resolve({ plugins: [] })),
}));

// Bare `vi.fn()`: see `use-theme-actions.test.ts` for why a typed zero-arg implementation
// breaks the spread wrapper below.
const themeUninstall = vi.fn();
vi.mock("../../../ipc/theme", () => ({
  themeUninstall: (...a: unknown[]) => themeUninstall(...a),
}));

import type { InstalledTheme } from "../../../themes/theme-install";
import type { ThemeDef } from "../../../types/theme";

import { useSettingsStore } from "../../../stores/settings/store";
import { defaultColorsForBase } from "../../../types/theme";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";
import { AppearanceTab } from "../tabs/AppearanceTab";

const CUSTOM_THEME: ThemeDef = {
  id: "custom-1730000000000",
  modes: { dark: { colors: defaultColorsForBase("light") } },
  name: "Mine",
  source: "custom",
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(showConfirm).mockReset();
  vi.mocked(showConfirm).mockResolvedValue(false);
  vi.mocked(showAlert).mockClear();
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [CUSTOM_THEME],
    locale: "en",
  });
});

afterEach(() => {
  useSettingsStore.setState({ customThemes: [], installedThemes: {} });
  themeUninstall.mockClear();
});

const INSTALLED_THEME: InstalledTheme = {
  checksum: "c".repeat(64),
  consentedAt: "2026-09-01T00:00:00.000Z",
  consentedVersion: "1.0.0",
  id: "dracula",
  installedAt: "2026-09-01T00:00:00.000Z",
  installPath: "/home/.baram/themes/dracula",
  manifest: {
    author: "a",
    description: "d",
    engines: { baram: ">=0.7.0" },
    id: "dracula",
    license: "MIT",
    modes: { light: { tokens: "light/tokens.json" } },
    name: "Dracula",
    version: "1.0.0",
  },
  modes: { light: { css: false } },
};

function themeDeleteButton(): HTMLElement {
  return screen.getByRole("button", { name: "Delete theme 'Mine'" });
}

describe("deleting a custom theme", () => {
  it("asks first, naming the theme, and keeps it when the answer is no", async () => {
    render(<AppearanceTab />);

    fireEvent.click(themeDeleteButton());
    await settle();

    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("Mine");
    expect(useSettingsStore.getState().customThemes).toEqual([CUSTOM_THEME]);
  });

  it("deletes when the answer is yes", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    render(<AppearanceTab />);

    fireEvent.click(themeDeleteButton());
    await settle();

    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });
});

// §356 갤러리는 출처별로 나뉜다 — 행이 무엇을 할 수 있는지는 그 출처가 정한다
// (theme-sources.ts). 그룹은 시각적으로는 예전과 같은 격자이고, 경계는
// role="group" + aria-label 로만 드러난다.
describe("theme gallery — groups by source (§356)", () => {
  it("테마를 출처별 그룹으로 나눠 보여준다", () => {
    useSettingsStore.setState({
      customThemes: [
        {
          id: "mine",
          name: "Mine",
          source: "custom",
          modes: { light: { colors: defaultColorsForBase("light") } },
        },
      ],
    });
    render(<AppearanceTab />);
    expect(screen.getByRole("group", { name: /기본|Built-in/i })).toBeTruthy();
    expect(
      screen.getByRole("group", { name: /내가 만든|My themes/i }),
    ).toBeTruthy();
  });

  it("내장 테마에는 제거 버튼이 없고 커스텀 테마에는 있다", () => {
    useSettingsStore.setState({
      customThemes: [
        {
          id: "mine",
          name: "Mine",
          source: "custom",
          modes: { light: { colors: defaultColorsForBase("light") } },
        },
      ],
    });
    render(<AppearanceTab />);
    const builtinGroup = screen.getByRole("group", { name: /기본|Built-in/i });
    const customGroup = screen.getByRole("group", {
      name: /내가 만든|My themes/i,
    });
    expect(
      within(builtinGroup).queryByRole("button", { name: /삭제|Delete/i }),
    ).toBeNull();
    expect(
      within(customGroup).getByRole("button", { name: /삭제|Delete/i }),
    ).toBeTruthy();
  });
});

// §361 — the sub-screen router. A single union rather than two booleans (AppearanceTab.tsx's
// header comment) — these tests are the "no if-order accident" half; ThemeBrowser.test.tsx
// and ThemeEditor.test.tsx each cover their own screen's content.
describe("sub-screen routing (§361)", () => {
  it("테마 찾아보기를 누르면 화면 본문이 브라우저로 바뀌고, 갤러리는 사라진다", () => {
    render(<AppearanceTab />);
    expect(screen.getByText("System (Auto)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /browse themes/i }));

    expect(screen.getByPlaceholderText(/search themes/i)).toBeInTheDocument();
    expect(screen.queryByText("System (Auto)")).toBeNull();
  });

  it("뒤로 가면 갤러리가 돌아온다", () => {
    render(<AppearanceTab />);
    fireEvent.click(screen.getByRole("button", { name: /browse themes/i }));
    fireEvent.click(screen.getByText(/back/i));

    expect(screen.getByText("System (Auto)")).toBeInTheDocument();
  });

  it("커스터마이즈로 들어간 뒤에는 브라우저가 아니라 편집기가 보인다", () => {
    render(<AppearanceTab />);
    fireEvent.click(screen.getByRole("button", { name: /customize/i }));

    // ThemeEditor's own chrome, not ThemeBrowser's search box.
    expect(screen.queryByPlaceholderText(/search themes/i)).toBeNull();
    expect(screen.queryByText("System (Auto)")).toBeNull();
  });
});

// §361 — the community group, filled for the first time. Actions come from
// `themeActions("community")` (theme-sources.ts), not a `source === …` check here.
describe("theme gallery — community group (§361)", () => {
  it("설치한 테마가 있으면 '설치한 테마' 그룹에 나타난다", () => {
    useSettingsStore.setState({
      installedThemes: { dracula: INSTALLED_THEME },
    });
    render(<AppearanceTab />);

    const group = screen.getByRole("group", { name: /설치한|Installed/i });
    expect(within(group).getByText("Dracula")).toBeInTheDocument();
  });

  it("설치한 테마에는 제거 버튼이 있고, 확인하면 언인스톨 IPC를 부른 뒤 목록에서 사라진다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    useSettingsStore.setState({
      installedThemes: { dracula: INSTALLED_THEME },
    });
    render(<AppearanceTab />);

    const group = screen.getByRole("group", { name: /설치한|Installed/i });
    fireEvent.click(
      within(group).getByRole("button", { name: /삭제|Delete/i }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(themeUninstall).toHaveBeenCalledWith("dracula");
    expect(useSettingsStore.getState().installedThemes).toEqual({});
  });

  it("설치한 테마를 고르면 즉시 활성화된다", () => {
    useSettingsStore.setState({
      installedThemes: { dracula: INSTALLED_THEME },
    });
    render(<AppearanceTab />);

    const group = screen.getByRole("group", { name: /설치한|Installed/i });
    fireEvent.click(within(group).getByText("Dracula"));

    expect(useSettingsStore.getState().activeThemeId).toBe("dracula");
  });

  // §361 fix round 1 (F2/M-E) — review round 1 removed the ⓘ affordance entirely
  // (`onInfo={undefined}`) and 199 tests stayed green; this is the fix.
  it("설치한 테마에는 설치 정보 버튼이 있고, 누르면 동의 내용을 보여준다 — RED under M-E", () => {
    useSettingsStore.setState({
      installedThemes: { dracula: INSTALLED_THEME },
    });
    render(<AppearanceTab />);

    const group = screen.getByRole("group", { name: /설치한|Installed/i });
    fireEvent.click(within(group).getByRole("button", { name: /정보|info/i }));

    expect(showAlert).toHaveBeenCalledTimes(1);
    const message = vi.mocked(showAlert).mock.calls[0][0];
    expect(message).toContain("1.0.0");
  });

  // §361 — a builtin/custom theme has consentHistory: false, so no info button renders for
  // it (theme-sources.ts's action table, not a `source === …` check in the component).
  it("내장·커스텀 테마에는 설치 정보 버튼이 없다", () => {
    render(<AppearanceTab />);
    const builtinGroup = screen.getByRole("group", { name: /기본|Built-in/i });
    expect(
      within(builtinGroup).queryByRole("button", { name: /정보|info/i }),
    ).toBeNull();
  });
});
