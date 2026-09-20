// issue 523 — deleting a custom theme or perspective asks first.
//
// Both are persisted data the user built by hand (a palette of 24 colours, a
// layout), and both were removed by one click on a small × overlaid on the
// card, with no way back. The file tree already confirms far less final
// deletions (a move to the trash) through the shared showConfirm dialog; the
// settings cards now use the same one. The dialog itself is mocked here — what
// is pinned is that the store does not change until it answers yes, and that
// the question names the item.
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

import type { WorkspacePreset } from "../../../stores/file/workspace";
import type { InstalledTheme } from "../../../themes/theme-install";
import type { ThemeDef } from "../../../types/theme";

import { useWorkspaceStore } from "../../../stores/file/workspace";
import { useSettingsStore } from "../../../stores/settings/store";
import { defaultColorsForBase } from "../../../types/theme";
import { showConfirm } from "../../../utils/confirm-dialog";
import { AppearanceTab } from "../tabs/AppearanceTab";

const CUSTOM_THEME: ThemeDef = {
  id: "custom-1730000000000",
  modes: { dark: { colors: defaultColorsForBase("light") } },
  name: "Mine",
  source: "custom",
};

const CUSTOM_PRESET: WorkspacePreset = {
  builtIn: false,
  description: "",
  id: "preset-1",
  layout: {
    rightPanelMode: "none",
    rightPanelOpen: false,
    sidebarOpen: true,
    sidebarPanel: "files",
  },
  name: "Deep work",
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(showConfirm).mockReset();
  vi.mocked(showConfirm).mockResolvedValue(false);
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [CUSTOM_THEME],
    locale: "en",
  });
  useWorkspaceStore.setState({
    activePresetId: null,
    customPresets: [CUSTOM_PRESET],
  });
});

afterEach(() => {
  useSettingsStore.setState({ customThemes: [], installedThemes: {} });
  useWorkspaceStore.setState({ customPresets: [] });
  themeUninstall.mockClear();
});

const INSTALLED_THEME: InstalledTheme = {
  checksum: "c".repeat(64),
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

function presetDeleteButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    "button.workspace-card-delete",
  );
  if (!button) throw new Error("preset delete button did not mount");
  return button;
}

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

describe("deleting a custom perspective", () => {
  it("asks first, naming the perspective, and keeps it when the answer is no", async () => {
    render(<AppearanceTab />);

    fireEvent.click(presetDeleteButton());
    await settle();

    expect(vi.mocked(showConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("Deep work");
    expect(useWorkspaceStore.getState().customPresets).toEqual([CUSTOM_PRESET]);
  });

  it("deletes when the answer is yes", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    render(<AppearanceTab />);

    fireEvent.click(presetDeleteButton());
    await settle();

    expect(useWorkspaceStore.getState().customPresets).toEqual([]);
  });
});

// §338/I-8 — the workspace gallery used to render `BUILTIN_PRESETS`
// unconditionally, so a disabled Journal/Zettel still offered a card here
// even though applying it (workspace.ts) already refused and toasted. This is
// the "render" half of that completeness pair (preset-feature-gate.test.ts is
// the "applyPreset agrees with PRESET_FEATURE" half). Custom presets are
// never filtered — "Deep work" (CUSTOM_PRESET) stays regardless.
describe("workspace gallery — preset feature gate (§338/I-8)", () => {
  // ‼️ en-only — `menu.workspace.*` and the (now-removed) `settings.workspace.preset.*` name
  // keys were BOTH "Writing"/"Journal"/"Skills" in en.json, so this assertion cannot see a wrong
  // or missing `nameKey` (§343; see `preset-labels.test.tsx` for the ko-locale assertions).
  it("hides the Journal card but keeps Writing/Skills/the custom preset when journal is off", () => {
    useSettingsStore.setState({ journalEnabled: false });
    render(<AppearanceTab />);

    expect(screen.queryByText("Journal")).toBeNull();
    expect(screen.getByText("Writing")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Deep work")).toBeInTheDocument();
  });

  it("shows the Journal card when journal is on — positive control", () => {
    useSettingsStore.setState({ journalEnabled: true });
    render(<AppearanceTab />);

    expect(screen.getByText("Journal")).toBeInTheDocument();
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
    expect(screen.queryByText("Perspectives")).toBeNull();
  });

  it("뒤로 가면 갤러리와 워크스페이스 섹션이 돌아온다", () => {
    render(<AppearanceTab />);
    fireEvent.click(screen.getByRole("button", { name: /browse themes/i }));
    fireEvent.click(screen.getByText(/back/i));

    expect(screen.getByText("System (Auto)")).toBeInTheDocument();
    expect(screen.getByText("Perspectives")).toBeInTheDocument();
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
});
