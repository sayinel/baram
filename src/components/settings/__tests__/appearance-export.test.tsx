// §371 6a — 외관을 테마로 내보내기(스펙 0062 §4). 무엇이 실리는지는 `appearance-package.test.ts` 가 보고,
// 여기서는 화면이 그것을 보이고 그 값을 파일로 넘기는지를 본다.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogMock = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: dialogMock.save }));
const themeIpc = vi.hoisted(() => ({ themePackageBuild: vi.fn() }));
vi.mock("../../../ipc/theme", () => ({
  themePackageBuild: themeIpc.themePackageBuild,
}));
const fsIpc = vi.hoisted(() => ({ exportBinaryFile: vi.fn() }));
vi.mock("../../../ipc/fs", () => ({
  exportBinaryFile: fsIpc.exportBinaryFile,
}));
const appVersion = vi.hoisted(() => ({ currentAppVersion: vi.fn() }));
vi.mock("../../../plugins/engines-app", () => ({
  currentAppVersion: appVersion.currentAppVersion,
}));

import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { BUILT_IN_THEMES } from "../../../types/theme";
import { AppearanceExport } from "../appearance-export";
import { dialOptionLabelKey } from "../dial-option-label";

const NORD = BUILT_IN_THEMES.find((t) => t.id === "nord")!;
const T = en as Record<string, string>;

function fillMeta(): void {
  const set = (placeholder: string, value: string) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value },
    });
  set(T["settings.theme.namePlaceholder"], "My Look");
  set(T["settings.theme.packageAuthorPlaceholder"], "a");
  set(T["settings.theme.packageDescriptionPlaceholder"], "d");
  set(T["settings.theme.packageLicensePlaceholder"], "MIT");
  set(T["settings.theme.packageVersionPlaceholder"], "1.0.0");
}

function manifestOfLastBuild(): Record<string, unknown> {
  const entries = themeIpc.themePackageBuild.mock.calls.at(-1)![0] as Record<
    string,
    Uint8Array
  >;
  return JSON.parse(
    new TextDecoder().decode(entries["baram-theme.json"]),
  ) as Record<string, unknown>;
}

beforeEach(() => {
  useSettingsStore.setState({
    activeThemeId: "nord",
    appearanceOverrides: { density: "compact" },
    customThemes: [],
    installedThemes: {},
    locale: "en",
  });
  useUIStore.setState({
    activityBarVisible: true,
    statusBarVisible: false,
    tabBarVisible: true,
  });
  dialogMock.save.mockReset().mockResolvedValue("/tmp/my-look.zip");
  themeIpc.themePackageBuild.mockReset().mockResolvedValue([1, 2, 3]);
  fsIpc.exportBinaryFile.mockReset().mockResolvedValue(undefined);
  appVersion.currentAppVersion.mockReset().mockResolvedValue("0.7.6");
});

describe("AppearanceExport — 요약", () => {
  it("입은 테마의 색과 기본값과 다른 다이얼을 설정 행의 이름 · 값으로 보인다", () => {
    render(<AppearanceExport onBack={() => {}} />);
    expect(screen.getByText(new RegExp(NORD.name))).toBeTruthy();
    expect(screen.getByText(T["settings.appearance.density"])).toBeTruthy();
    expect(
      screen.getByText(T[dialOptionLabelKey("density", "compact")]),
    ).toBeTruthy();
  });

  it("다른 다이얼이 없으면 색만 담긴다고 적는다", () => {
    useSettingsStore.setState({ appearanceOverrides: {} });
    render(<AppearanceExport onBack={() => {}} />);
    expect(
      screen.getByText(T["settings.appearance.exportLook.noDials"]),
    ).toBeTruthy();
  });

  it("숨긴 표시줄이 없으면 확인란이 꺼진다", () => {
    useUIStore.setState({ statusBarVisible: true });
    render(<AppearanceExport onBack={() => {}} />);
    const box = screen.getByRole("checkbox", {
      name: T["settings.appearance.exportLook.includeChrome"],
    });
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.getByText(T["settings.appearance.exportLook.noHiddenBars"]),
    ).toBeTruthy();
  });

  it("CSS 안내는 저장 CSS 가 있는 설치 테마를 입었을 때만 나온다", () => {
    const { unmount } = render(<AppearanceExport onBack={() => {}} />);
    expect(
      screen.queryByText(T["settings.appearance.exportLook.cssNotice"]),
    ).toBeNull();
    unmount();
    useSettingsStore.setState({
      activeThemeId: "ink",
      installedThemes: {
        ink: {
          checksum: "c".repeat(64),
          consentedAt: "t",
          consentedVersion: "1.0.0",
          id: "ink",
          installedAt: "t",
          installPath: "/p",
          manifest: {
            author: "a",
            description: "d",
            engines: { baram: ">=0.7.4" },
            id: "ink",
            license: "MIT",
            modes: { dark: { css: "dark/theme.css" } },
            name: "Ink",
            version: "1.0.0",
          },
          modes: { dark: { css: true } },
        },
      },
    });
    render(<AppearanceExport onBack={() => {}} />);
    expect(
      screen.getByText(T["settings.appearance.exportLook.cssNotice"]),
    ).toBeTruthy();
  });
});

describe("AppearanceExport — 내보내기", () => {
  it("이름과 메타를 다 채우기 전에는 버튼이 꺼져 있다", () => {
    render(<AppearanceExport onBack={() => {}} />);
    const button = screen.getByRole("button", {
      name: T["settings.theme.exportPackage"],
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fillMeta();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  // 무엇이 이것을 실패시키는가: 화면이 요약과 다른 입력으로 파일을 만들거나, 하한을 상수로 남기면.
  it("다이얼을 싣고 앱 버전을 하한으로, 확인란이 꺼져 있으면 크롬 없이 쓴다", async () => {
    render(<AppearanceExport onBack={() => {}} />);
    fillMeta();
    fireEvent.click(
      screen.getByRole("button", { name: T["settings.theme.exportPackage"] }),
    );
    await waitFor(() =>
      expect(fsIpc.exportBinaryFile).toHaveBeenCalledWith(
        "/tmp/my-look.zip",
        [1, 2, 3],
      ),
    );
    const manifest = manifestOfLastBuild();
    expect(manifest.dials).toEqual({ density: "compact" });
    expect(manifest.engines).toEqual({ baram: ">=0.7.6" });
    expect(manifest).not.toHaveProperty("chrome");
    expect(manifest.id).toBe("my-look");
    expect(manifest.name).toBe("My Look");
  });

  it("확인란을 켜면 숨긴 표시줄만 제안한다", async () => {
    render(<AppearanceExport onBack={() => {}} />);
    fillMeta();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: T["settings.appearance.exportLook.includeChrome"],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: T["settings.theme.exportPackage"] }),
    );
    await waitFor(() => expect(themeIpc.themePackageBuild).toHaveBeenCalled());
    expect(manifestOfLastBuild().chrome).toEqual({ statusBar: false });
  });

  it("앱 버전을 읽지 못하면 다이얼이 실린 패키지를 쓰지 않는다", async () => {
    appVersion.currentAppVersion.mockResolvedValue(null);
    render(<AppearanceExport onBack={() => {}} />);
    fillMeta();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: T["settings.theme.exportPackage"] }),
      );
    });
    expect(dialogMock.save).not.toHaveBeenCalled();
    expect(themeIpc.themePackageBuild).not.toHaveBeenCalled();
    expect(useUIStore.getState().toast?.message).toBe(
      T["settings.appearance.exportLook.versionUnknown"],
    );
  });

  it("색만 담는 패키지는 앱 버전 없이도 지금 하한으로 쓴다", async () => {
    useSettingsStore.setState({ appearanceOverrides: {} });
    appVersion.currentAppVersion.mockResolvedValue(null);
    render(<AppearanceExport onBack={() => {}} />);
    fillMeta();
    fireEvent.click(
      screen.getByRole("button", { name: T["settings.theme.exportPackage"] }),
    );
    await waitFor(() => expect(themeIpc.themePackageBuild).toHaveBeenCalled());
    expect(manifestOfLastBuild().engines).toEqual({ baram: ">=0.7.4" });
  });
});
