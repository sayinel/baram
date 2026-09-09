import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { MENU_FEATURE_MAP, syncMenuEnabled } = await import("../menu-enabled");

describe("native menu enable sync (§341)", () => {
  it("covers every feature-owned menu id", () => {
    // ‼️ `view_inline_ai` 는 `ai.` 패턴에 안 걸려 첫 열거에서 빠졌다 (§337-(2))
    expect(Object.keys(MENU_FEATURE_MAP).sort()).toEqual([
      "view_ai_chat",
      "view_calendar",
      "view_inline_ai",
      "workspace_journal",
      "workspace_zettel",
    ]);
  });

  it("sends one boolean per menu id", async () => {
    invoke.mockClear();
    await syncMenuEnabled({
      ai: false,
      journal: true,
      tasks: true,
      zettelkasten: false,
    });
    // toHaveBeenCalledWith 는 undefined 키를 못 본다 — 인자를 직접 비교한다
    expect(invoke.mock.calls[0][0]).toBe("update_menu_enabled");
    expect(invoke.mock.calls[0][1]).toStrictEqual({
      items: {
        view_ai_chat: false,
        view_calendar: true,
        view_inline_ai: false,
        workspace_journal: true,
        workspace_zettel: false,
      },
    });
  });
});
