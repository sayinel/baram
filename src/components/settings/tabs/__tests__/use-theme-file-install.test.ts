// §371 6a — 파일에서 테마 설치(스펙 0062 §5). 관문은 레지스트리 설치와 같고(예약 id · 하한 · 철회 · 동의),
// 스테이징 이후는 `installStagedThemeFromFile` 이 레지스트리 입구와 같은 함수로 끝낸다.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ themeInstallDiscard: vi.fn() }));
// `importOriginal` + spread — `theme-install.ts`(실물의 `parseThemeManifestText` 를 쓴다)가 같은 모듈의 다른
// export 를 import 한다. 맨 팩토리는 그것들을 `undefined` 로 남긴다.
vi.mock("../../../../ipc/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/theme")>()),
  themeInstallDiscard: ipc.themeInstallDiscard,
}));
const install = vi.hoisted(() => ({ installStagedThemeFromFile: vi.fn() }));
vi.mock("../../../../themes/theme-install", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../themes/theme-install")
  >()),
  installStagedThemeFromFile: install.installStagedThemeFromFile,
}));
const confirm = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock("../../../../utils/confirm-dialog", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../utils/confirm-dialog")
  >()),
  showConfirm: confirm.showConfirm,
}));
const appVersion = vi.hoisted(() => vi.fn(() => Promise.resolve("0.7.6")));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: appVersion }));

import en from "../../../../i18n/en.json";
import { useSettingsStore } from "../../../../stores/settings/store";
import { usePluginStore } from "../../../../stores/system/plugin";
import { useThemeActions } from "../use-theme-actions";
import { useThemeFileInstall } from "../use-theme-file-install";

const T = en as Record<string, string>;

function manifest(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    author: "a",
    description: "d",
    engines: { baram: ">=0.1.0" },
    id: "my-look",
    license: "MIT",
    modes: { light: { tokens: "light/tokens.json" } },
    name: "My Look",
    version: "1.0.0",
    ...over,
  });
}
const staged = (m = manifest()) => ({
  checksum: "c".repeat(64),
  manifest: m,
  manifest_sha256: "d".repeat(64),
  stage_id: "stage-f",
});

const askConsent = vi.fn();
const announceInstalled = vi.fn();
const hook = () =>
  renderHook(() => useThemeFileInstall({ announceInstalled, askConsent }))
    .result.current;

beforeEach(() => {
  ipc.themeInstallDiscard.mockReset().mockResolvedValue(undefined);
  install.installStagedThemeFromFile.mockReset();
  confirm.showConfirm.mockReset();
  askConsent.mockReset().mockResolvedValue(true);
  announceInstalled.mockReset();
  useSettingsStore.setState({ installedThemes: {}, locale: "en" });
  usePluginStore.setState({ revocations: null });
});

describe("useThemeFileInstall", () => {
  it("동의를 받고 설치하고 기록한 뒤 적용을 알린다", async () => {
    const record = {
      id: "my-look",
      manifest: { name: "My Look", version: "1.0.0" },
      origin: "file",
    };
    install.installStagedThemeFromFile.mockResolvedValue({
      installed: record,
      ok: true,
    });
    const error = await hook().handleInstallFromFile(staged(), "look.zip");
    expect(error).toBeNull();
    // 계획 0109 P2 — 파일 이름은 동의 제목의 이름 칸에 실린다.
    expect(askConsent).toHaveBeenCalledWith("My Look — look.zip");
    expect(
      useSettingsStore.getState().installedThemes["my-look"],
    ).toMatchObject({ origin: "file" });
    expect(announceInstalled).toHaveBeenCalledWith(record, []);
  });

  // 무엇이 이것을 실패시키는가: 동의를 거절했는데 stage 를 남기거나 설치를 부르면.
  it("동의를 거절하면 설치하지 않고 stage 를 버린다", async () => {
    askConsent.mockResolvedValue(false);
    expect(await hook().handleInstallFromFile(staged(), "look.zip")).toBeNull();
    expect(install.installStagedThemeFromFile).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalledWith("stage-f");
  });

  it("매니페스트가 틀리면 동의를 묻지 않고 stage 를 버린다", async () => {
    const error = await hook().handleInstallFromFile(
      staged("{not json"),
      "look.zip",
    );
    expect(error).toBe(T["settings.appearance.installError.manifestInvalid"]);
    expect(askConsent).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalledWith("stage-f");
  });

  // 계획 0109 P3 — 이미 거절될 설치에 동의를 받지 않는다.
  it("예약 id 는 동의 전에 거부한다", async () => {
    const error = await hook().handleInstallFromFile(
      staged(manifest({ id: "nord" })),
      "look.zip",
    );
    expect(error).toContain("nord");
    expect(askConsent).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalled();
  });

  it("앱이 하한보다 낮으면 동의 전에 거부한다", async () => {
    const error = await hook().handleInstallFromFile(
      staged(manifest({ engines: { baram: ">=9.0.0" } })),
      "look.zip",
    );
    expect(error).not.toBeNull();
    expect(askConsent).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalled();
  });

  // §69 — 레지스트리 입구(`theme-update-revocation.test.ts` 의 `revoke`)와 같은 모양의 목록. 심각도는 가장
  // 낮은 `unlisted` 다 — 새로 들이는 것은 심각도와 무관하게 거부한다는 것을 그 끝에서 고정한다.
  // 무엇이 이것을 실패시키는가: 철회 검사를 지우거나 동의 뒤로 옮기면 `askConsent` 가 불린다.
  it("철회된 버전은 동의 전에 거부한다", async () => {
    usePluginStore.setState({
      revocations: {
        revoked: [
          {
            id: "my-look",
            reason: "compromised build",
            severity: "unlisted",
            versions: "*",
          },
        ],
        sequence: 1,
        version: 1,
      },
    });
    const error = await hook().handleInstallFromFile(staged(), "look.zip");
    expect(error).toContain("compromised build");
    expect(askConsent).not.toHaveBeenCalled();
    expect(install.installStagedThemeFromFile).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalledWith("stage-f");
  });

  it("레지스트리로 설치한 같은 id 가 있으면 교체를 확인하고, 취소하면 버린다", async () => {
    useSettingsStore.setState({
      installedThemes: {
        "my-look": {
          id: "my-look",
          manifest: { name: "Old", version: "0.9.0" },
        } as never,
      },
    });
    confirm.showConfirm.mockResolvedValue(false);
    expect(await hook().handleInstallFromFile(staged(), "look.zip")).toBeNull();
    expect(confirm.showConfirm.mock.calls[0][0]).toBe(
      T["settings.appearance.installFromFile.replaceRegistry"].replace(
        "{name}",
        "Old",
      ),
    );
    expect(askConsent).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalled();
  });

  it("파일로 설치한 같은 id 는 버전을 보이며 교체를 확인한다", async () => {
    useSettingsStore.setState({
      installedThemes: {
        "my-look": {
          id: "my-look",
          manifest: { name: "My Look", version: "0.9.0" },
          origin: "file",
        } as never,
      },
    });
    confirm.showConfirm.mockResolvedValue(true);
    install.installStagedThemeFromFile.mockResolvedValue({
      installed: {
        id: "my-look",
        manifest: { name: "My Look", version: "1.0.0" },
        origin: "file",
      },
      ok: true,
    });
    await hook().handleInstallFromFile(staged(), "look.zip");
    expect(confirm.showConfirm.mock.calls[0][0]).toContain("0.9.0");
    expect(confirm.showConfirm.mock.calls[0][0]).toContain("1.0.0");
  });

  it("설치가 실패하면 그 사유 문구를 돌려준다", async () => {
    install.installStagedThemeFromFile.mockResolvedValue({
      ok: false,
      reason: "commitFailed",
    });
    expect(await hook().handleInstallFromFile(staged(), "look.zip")).toBe(
      T["settings.appearance.installError.commitFailed"],
    );
    expect(announceInstalled).not.toHaveBeenCalled();
  });

  // 계획 0109 보안 관문 Low-1 — 화면(동의 상태의 주인)이 사라진 뒤 동의에 닿는 설치. 여기만 진짜
  // `useThemeActions` 를 쓴다. 무엇이 이것을 실패시키는가: `askConsent` 의 `mounted` 검사를 지우면 그
  // 약속이 끝나지 않아 아래 경주에서 "pending" 이 이기고, stage 도 버려지지 않는다.
  it("동의 상태의 주인이 언마운트된 뒤 동의에 닿으면 거절로 끝나고 stage 를 버린다", async () => {
    const { result, unmount } = renderHook(() =>
      useThemeFileInstall(useThemeActions()),
    );
    const { handleInstallFromFile } = result.current;
    unmount();
    expect(
      await settledWithin(handleInstallFromFile(staged(), "look.zip")),
    ).toEqual({ value: null });
    expect(install.installStagedThemeFromFile).not.toHaveBeenCalled();
    expect(ipc.themeInstallDiscard).toHaveBeenCalledWith("stage-f");
  });

  // 계획 0109 보안 관문 Low-3a. 무엇이 이것을 실패시키는가: `consentFileName` 을 거치지 않고 OS 가 준
  // 이름을 그대로 넘기면 방향 override 와 줄바꿈이 동의 제목에 실린다.
  it("파일 이름의 방향 제어 · 줄바꿈은 동의 제목에 실리기 전에 U+FFFD 가 된다", async () => {
    askConsent.mockResolvedValue(false);
    await hook().handleInstallFromFile(staged(), "evil\u202Egpj.zip\nline2");
    expect(askConsent).toHaveBeenCalledWith(
      "My Look — evil\uFFFDgpj.zip\uFFFDline2",
    );
  });

  // 코드 포인트로 자른다 — UTF-16 단위로 자르면 이모지가 반쪽 surrogate 로 끝나 이 단언이 red 다.
  it("긴 파일 이름은 코드 포인트 100 자(끝의 … 포함)로 자르고, 100 자는 그대로 둔다", async () => {
    askConsent.mockResolvedValue(false);
    await hook().handleInstallFromFile(staged(), "😀".repeat(300));
    await hook().handleInstallFromFile(staged(), "a".repeat(100));
    expect(askConsent.mock.calls.map(([title]) => title)).toEqual([
      `My Look — ${"😀".repeat(99)}…`,
      `My Look — ${"a".repeat(100)}`,
    ]);
  });
});

/** `promise` 가 `ms` 안에 끝나면 그 값을, 아니면 `"pending"` 을 — 끝나지 않는 약속이 테스트를 멈추게 두지 않는다. */
function settledWithin<T>(
  promise: Promise<T>,
  ms = 200,
): Promise<"pending" | { value: T }> {
  return Promise.race([
    promise.then((value) => ({ value })),
    new Promise<"pending">((resolve) =>
      setTimeout(() => resolve("pending"), ms),
    ),
  ]);
}
