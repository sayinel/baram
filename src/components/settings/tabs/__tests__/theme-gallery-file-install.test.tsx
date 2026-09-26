// §371 6a — 갤러리의 배선. `테마 가져오기...` 가 고른 패키지의 동의 대화상자는 이 화면이 그린다.
//
// 훅 테스트(`use-theme-file-install.test.ts`)는 `askConsent` 를 가짜로 넣으므로, 파일 설치 훅이 대화상자 상태의
// 주인(`useThemeActions`)과 **같은 인스턴스**에 이어져 있는지는 여기서만 보인다. 무엇이 이것을 실패시키는가:
// 갤러리가 대화상자를 그리지 않거나, 다른 `useThemeActions()` 의 `askConsent` 를 넘기면 대화상자가 나타나지
// 않는다(`findSurface` 가 시간 초과한다).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../ipc/plugin-invoke", () => ({
  pluginFetchRegistry: vi.fn(() => Promise.resolve({ plugins: [] })),
}));
const ipc = vi.hoisted(() => ({
  themeImportPick: vi.fn(),
  themeInstallDiscard: vi.fn(),
}));
vi.mock("../../../../ipc/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/theme")>()),
  themeImportPick: ipc.themeImportPick,
  themeInstallDiscard: ipc.themeInstallDiscard,
}));
const install = vi.hoisted(() => ({ installStagedThemeFromFile: vi.fn() }));
vi.mock("../../../../themes/theme-install", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../themes/theme-install")
  >()),
  installStagedThemeFromFile: install.installStagedThemeFromFile,
}));
const appVersion = vi.hoisted(() => vi.fn(() => Promise.resolve("0.7.6")));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: appVersion }));

import { findSurface } from "../../../../__tests__/helpers/security-surface";
import en from "../../../../i18n/en.json";
import { useSettingsStore } from "../../../../stores/settings/store";
import { usePluginStore } from "../../../../stores/system/plugin";
import { ThemeGallery } from "../theme-gallery";

const EN = en as Record<string, string>;

const staged = {
  checksum: "c".repeat(64),
  manifest: JSON.stringify({
    author: "a",
    description: "d",
    engines: { baram: ">=0.1.0" },
    id: "my-look",
    license: "MIT",
    modes: { light: { tokens: "light/tokens.json" } },
    name: "My Look",
    version: "1.0.0",
  }),
  manifest_sha256: "d".repeat(64),
  stage_id: "stage-g",
};

beforeEach(() => {
  ipc.themeImportPick.mockReset().mockResolvedValue({
    fileName: "look.zip",
    kind: "package",
    staged,
  });
  ipc.themeInstallDiscard.mockReset().mockResolvedValue(undefined);
  install.installStagedThemeFromFile.mockReset().mockResolvedValue({
    ok: false,
    reason: "commitFailed",
  });
  useSettingsStore.setState({
    customThemes: [],
    installedThemes: {},
    locale: "en",
  });
  usePluginStore.setState({ revocations: null });
});

async function openConsent() {
  render(
    <ThemeGallery
      onBrowseThemes={() => {}}
      onCustomize={() => {}}
      onExportLook={() => {}}
    />,
  );
  fireEvent.click(screen.getByText(EN["settings.appearance.import"]));
  return findSurface(".theme-consent");
}

describe("the gallery's file install", () => {
  it("asks consent on this screen, naming the file, and installs on confirm", async () => {
    const dialog = await openConsent();
    // 계획 0109 P2 — 파일 이름은 제목의 이름 칸에 실린다.
    expect(dialog.getByText(/My Look — look\.zip/)).toBeInTheDocument();
    expect(install.installStagedThemeFromFile).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: /install/i }));
    await waitFor(() =>
      expect(install.installStagedThemeFromFile).toHaveBeenCalledWith(staged),
    );
  });

  it("discards the stage and installs nothing on cancel", async () => {
    const dialog = await openConsent();
    fireEvent.click(dialog.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(ipc.themeInstallDiscard).toHaveBeenCalledWith("stage-g"),
    );
    expect(install.installStagedThemeFromFile).not.toHaveBeenCalled();
  });
});
