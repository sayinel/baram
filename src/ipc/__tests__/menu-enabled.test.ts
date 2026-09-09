// ‼️ Literal path scan — `MENU_RS_PATH` below reads src-tauri/src/menu.rs. Moving that file
// leaves this reading nothing (or something stale) and the derived test below refuses rather
// than passing silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { MENU_FEATURE_MAP, syncMenuEnabled } = await import("../menu-enabled");

const MENU_RS_PATH = join(process.cwd(), "src-tauri/src/menu.rs");

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

  // §341 리뷰 — `MENU_FEATURE_MAP`의 다섯 id를 Rust 쪽에서도 손으로 다시 세면(예:
  // menu.rs 자체 테스트) 두 열거가 갈라져도 아무것도 실패하지 않는다: 맵에 여섯 번째
  // id를 더해도 커맨드는 여전히 동작하고(`items.get()`이 그냥 `None`), 그 항목이
  // 실제 메뉴에 없다는 사실을 아무도 확인하지 않는다. 그래서 이 맵의 키를 Rust
  // 소스에서 **파생 검증**한다 — 손으로 두 번째 목록을 유지하지 않는다
  // (`scripts/rust-constants.ts`가 같은 이유로 Rust 소스를 TS에서 읽는 선례).
  it("every key is an id menu.rs actually registers as a menu item", () => {
    const menuSource = readFileSync(MENU_RS_PATH, "utf8");
    for (const id of Object.keys(MENU_FEATURE_MAP)) {
      expect(menuSource).toContain(`menu_items.insert("${id}".into()`);
    }
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
