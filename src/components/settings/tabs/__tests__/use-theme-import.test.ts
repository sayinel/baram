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
import { logger } from "../../../../utils/logger";
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

  // 계획 0110 보안 관문 — V8 의 `JSON.parse` 문구는 입력의 앞부분을 인용한다. 무엇이 이것을 실패시키는가:
  // 오류 객체를 그대로 로그에 넘기면 두 번째 단언이 red 다. 첫 단언은 그 전제(문구가 입력을 인용한다)를
  // 이 런타임에서 고정한다 — 인용하지 않는 런타임이라면 이 테스트는 아무것도 막지 않는다.
  it("JSON 이 아닌 색 파일은 오류의 종류만 로그에 남긴다", async () => {
    const text = "SECRET-TOKEN not json";
    expect(() => JSON.parse(text)).toThrow(/SECRET/);
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      ipc.themeImportPick.mockResolvedValue({ kind: "colors", text });
      const result = await run();
      expect(error).toHaveBeenCalledWith("Theme import failed:", "SyntaxError");
      expect(result.current.importError).toBe(
        T["settings.appearance.importError.readFailed"],
      );
    } finally {
      error.mockRestore();
    }
  });

  it("그 밖의 오류는 원문 그대로 로그에 남긴다", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      ipc.themeImportPick.mockRejectedValue("theme id must be …");
      await run();
      expect(error).toHaveBeenCalledWith(
        "Theme import failed:",
        "theme id must be …",
      );
    } finally {
      error.mockRestore();
    }
  });

  // 계획 0110 최종 리뷰 — 두 번 누르면 네이티브 대화상자가 둘 열렸다. 무엇이 이것을 실패시키는가:
  // `inFlight` 관문을 지우면 두 번째 호출도 `themeImportPick` 에 닿아 2 가 된다. 끝난 뒤에는 다시 열린다는
  // 세 번째 호출이 짝이다 — 관문을 풀지 않는(`finally` 를 지운) 구현은 그 단언에서 red 다.
  it("가져오기가 진행 중이면 다음 호출은 대화상자를 열지 않고, 끝나면 다시 연다", async () => {
    let answer: (pick: null) => void = () => {};
    ipc.themeImportPick.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { result } = renderHook(() => useThemeImport(onPackage));
    await act(async () => {
      const first = result.current.handleImport();
      await result.current.handleImport();
      answer(null);
      await first;
    });
    expect(ipc.themeImportPick).toHaveBeenCalledTimes(1);

    ipc.themeImportPick.mockResolvedValue(null);
    await act(() => result.current.handleImport());
    expect(ipc.themeImportPick).toHaveBeenCalledTimes(2);
  });
});
