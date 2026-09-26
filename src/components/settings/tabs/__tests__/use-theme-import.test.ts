// §54 · §371 6a — 가져오기 버튼의 판별. 색 설정의 검증 규칙 자체는 바뀌지 않았다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ themeImportPick: vi.fn() }));
vi.mock("../../../../ipc/theme", () => ({
  themeImportPick: ipc.themeImportPick,
}));

import en from "../../../../i18n/en.json";
import { useSettingsStore } from "../../../../stores/settings/store";
import { defaultColorsForBase } from "../../../../types/theme";
import { useThemeImport } from "../use-theme-import";

const T = en as Record<string, string>;
const onPackage = vi.fn();

beforeEach(() => {
  ipc.themeImportPick.mockReset();
  onPackage.mockReset().mockResolvedValue(null);
  useSettingsStore.setState({ customThemes: [], locale: "en" });
});

async function run() {
  const { result } = renderHook(() => useThemeImport(onPackage));
  await act(() => result.current.handleImport());
  return result;
}

describe("useThemeImport", () => {
  it("취소하면 아무것도 하지 않는다", async () => {
    ipc.themeImportPick.mockResolvedValue(null);
    const result = await run();
    expect(result.current.importError).toBeNull();
    expect(onPackage).not.toHaveBeenCalled();
  });

  it("색 설정은 지금처럼 커스텀 테마로 저장된다", async () => {
    ipc.themeImportPick.mockResolvedValue({
      kind: "colors",
      text: JSON.stringify({
        base: "light",
        colors: defaultColorsForBase("light"),
        name: "Mine",
      }),
    });
    await run();
    expect(useSettingsStore.getState().customThemes.map((t) => t.name)).toEqual(
      ["Mine"],
    );
  });

  it("패키지는 파일 설치로 넘기고, 돌아온 문구를 보인다", async () => {
    const staged = {
      checksum: "c",
      manifest: "{}",
      manifest_sha256: "d",
      stage_id: "s",
    };
    ipc.themeImportPick.mockResolvedValue({
      fileName: "look.zip",
      kind: "package",
      staged,
    });
    onPackage.mockResolvedValue("nope");
    const result = await run();
    expect(onPackage).toHaveBeenCalledWith(staged, "look.zip");
    expect(result.current.importError).toBe("nope");
  });

  it.each([
    ["colors", "settings.appearance.importError.tooLarge"],
    ["package", "settings.appearance.importError.packageTooLarge"],
  ] as const)("너무 큰 %s 는 그 상한의 문구로", async (format, key) => {
    ipc.themeImportPick.mockResolvedValue({ format, kind: "tooLarge" });
    const result = await run();
    expect(result.current.importError).toBe(T[key]);
  });

  it("Rust 의 그 밖의 오류는 일반 문구로", async () => {
    ipc.themeImportPick.mockRejectedValue("theme id must be …");
    const result = await run();
    expect(result.current.importError).toBe(
      T["settings.appearance.importError.readFailed"],
    );
  });
});
