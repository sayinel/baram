import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { listFonts } from "../font";

describe("listFonts", () => {
  beforeEach(() => invoke.mockReset());

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
    const fonts = await listFonts();
    expect(fonts.map((f) => f.name)).toContain("Pretendard Variable");
    expect(fonts.map((f) => f.name)).toContain("JetBrains Mono Variable");
  });

  it("falls back when the command returns an empty list", async () => {
    invoke.mockResolvedValue([]);
    const fonts = await listFonts();
    expect(fonts.length).toBeGreaterThan(0);
  });
});
