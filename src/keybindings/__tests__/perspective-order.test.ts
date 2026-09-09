import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { KEYBINDING_REGISTRY } from "../keybinding-registry";

const PERSPECTIVES = ["writing", "zettelkasten", "journal", "skills"] as const;

/** menu.rs 의 소스에서 퍼스펙티브 항목의 순서와 accelerator 를 뽑는다. */
function readMenuRs() {
  // ‼️ 리터럴 경로 스캔 — 심볼을 옮기면 이 검증이 조용히 죽는다. 이동 시 함께 갱신할 것.
  const src = readFileSync(
    path.posix.join(process.cwd(), "src-tauri/src/menu.rs"),
    "utf8",
  );
  const accel: Record<string, string> = {};
  for (const m of src.matchAll(
    /let workspace_(\w+) = MenuItemBuilder[\s\S]{0,200}?\.accelerator\("([^"]+)"\)/g,
  )) {
    accel[m[1]] = m[2];
  }
  // `.item(&workspace_menu)` also matches the raw pattern below — that's the
  // Perspective *submenu itself* being inserted into the top-level menu bar,
  // not a leaf entry. Leaf entries are the ones built with an accelerator, so
  // filtering against `accel` excludes the submenu container structurally
  // rather than by naming it.
  const order = [...src.matchAll(/\.item\(&workspace_(\w+)\)/g)]
    .map((m) => m[1])
    .filter((id) => id in accel);
  return { accel, order };
}

/** `Alt+CmdOrCtrl+2` ↔ `Mod+Alt+2` 를 비교 가능한 형태로 정규화한다. */
function normalize(key: string): string {
  return key
    .split("+")
    .map((p) => (p === "CmdOrCtrl" ? "Mod" : p))
    .sort()
    .join("+");
}

describe("perspective order is one order everywhere (§343)", () => {
  it("the registry lists perspectives in the canonical order", () => {
    const ids = KEYBINDING_REGISTRY.filter(
      (k) => k.category === "workspace",
    ).map((k) => k.id.replace("workspace.", ""));
    expect(ids).toEqual([...PERSPECTIVES]);
  });

  it("menu.rs lists them in the same order — derived, not a literal", () => {
    const { order } = readMenuRs();
    // menu.rs 는 `zettel` 을 쓰고 레지스트리는 `zettelkasten` 을 쓴다
    const asRegistry = order.map((o) => (o === "zettel" ? "zettelkasten" : o));
    expect(asRegistry).toEqual([...PERSPECTIVES]);
  });

  it("the two layers agree on every accelerator", () => {
    // 이 결함의 정확한 모양이 "두 레이어가 어긋남" 이었다 — 한 파일만 보는
    // 테스트는 재발을 막지 못한다
    const { accel } = readMenuRs();
    for (const p of PERSPECTIVES) {
      const registry = KEYBINDING_REGISTRY.find(
        (k) => k.id === `workspace.${p}`,
      );
      const menuKey = accel[p === "zettelkasten" ? "zettel" : p];
      expect(registry, `workspace.${p} in registry`).toBeDefined();
      expect(menuKey, `workspace_${p} accelerator in menu.rs`).toBeDefined();
      expect(normalize(menuKey!)).toBe(normalize(registry!.defaultKey));
    }
  });

  it("assigns Mod+Alt+1..4 in the canonical order", () => {
    PERSPECTIVES.forEach((p, i) => {
      const entry = KEYBINDING_REGISTRY.find((k) => k.id === `workspace.${p}`);
      expect(entry!.defaultKey).toBe(`Mod+Alt+${i + 1}`);
    });
  });
});
