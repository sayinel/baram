import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { listFonts } from "../font";

describe("listFonts", () => {
  // 블록 바디 필수 — 화살표 식 바디는 `mockReset()`의 반환값(모킹 함수 자신)을 그대로
  // beforeEach 밖으로 돌려준다. vitest는 beforeEach가 함수를 반환하면 그 함수를 해당
  // 테스트의 cleanup으로 등록해 테스트가 끝난 뒤 인자 없이 호출한다
  // (getBeforeHookCleanupCallback, vitest/dist/chunks/run.*.js). "no font dir" 로
  // 리젝트를 설정한 테스트 뒤에 그 cleanup이 invoke()를 호출하면 아무도 await·catch하지
  // 않는 리젝트가 새로 생겨 "Unknown Error"로 보고된다 — 테스트 자체의 try/catch와는 무관.
  beforeEach(() => {
    invoke.mockReset();
  });

  it("passes refresh through to the command", async () => {
    invoke.mockResolvedValue([]);
    await listFonts(true);
    expect(invoke).toHaveBeenCalledWith("font_list", { refresh: true });
  });

  it("defaults refresh to false", async () => {
    invoke.mockResolvedValue([]);
    await listFonts();
    expect(invoke).toHaveBeenCalledWith("font_list", { refresh: false });
  });

  // §350 폴백: 피커가 비는 일은 없어야 한다.
  it("falls back to the bundled families when the command errors", async () => {
    invoke.mockRejectedValue("no font dir");
    const result = await listFonts();
    expect(result.fonts.map((f) => f.name)).toContain("Pretendard Variable");
    expect(result.fonts.map((f) => f.name)).toContain(
      "JetBrains Mono Variable",
    );
  });

  it("falls back when the command returns an empty list", async () => {
    invoke.mockResolvedValue([]);
    const result = await listFonts();
    expect(result.fonts.length).toBeGreaterThan(0);
  });

  // §351 리뷰 Important 2 — 호출자가 이 목록을 이 머신의 권위로 믿어도 되는지
  // 구분할 수 있어야 한다: 실패·빈 결과는 폴백이고, 폴백은 "이 머신에 없다"고
  // 말할 근거가 아니다.
  it.each([
    ["errors", () => invoke.mockRejectedValue("no font dir")],
    ["returns an empty list", () => invoke.mockResolvedValue([])],
  ])("marks the result as a fallback when the command %s", async (_, setup) => {
    setup();
    const result = await listFonts();
    expect(result.isFallback).toBe(true);
  });

  it("marks the result as NOT a fallback when the command returns real fonts", async () => {
    invoke.mockResolvedValue([
      { hasKorean: false, monospaced: false, name: "Arial", weights: [400] },
    ]);
    const result = await listFonts();
    expect(result.isFallback).toBe(false);
    expect(result.fonts.map((f) => f.name)).toEqual(["Arial"]);
  });
});
