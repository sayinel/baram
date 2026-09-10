import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BUILTIN_PRESETS } from "../../stores/file/workspace";
import { KEYBINDING_REGISTRY } from "../keybinding-registry";

// 정본 순서는 BUILTIN_PRESETS 하나가 정한다 — 그 배열의 리터럴 고정은
// workspace-store.test.ts 에 있고, 다른 표면은 전부 그것에서 파생시킨다.
//
// ‼️ 퍼스펙티브를 나열/광고하는 표면은 **네 곳**이고, 어디서 고정되는지 여기에
// 적어 둔다(§345/M-9). 목록을 베끼면 낡으므로 **지목**한다:
//   1. `keybinding-registry.ts` 배열 순서 → 이 파일
//   2. `src-tauri/src/menu.rs` 서브메뉴 순서·accelerator → 이 파일(소스 파생)
//   3. 상태바 드롭다운 = `BUILTIN_PRESETS` 를 직접 순회 → `workspace-store.test.ts`
//   4. 커맨드 팔레트 순서·광고 숫자 → `command/__tests__/command-registry.test.ts`
const PERSPECTIVES = BUILTIN_PRESETS.map((p) => p.id);

/** menu.rs 의 소스에서 퍼스펙티브 항목의 순서와 accelerator 를 뽑는다. */
function readMenuRs() {
  // ‼️ 리터럴 경로 스캔 — 심볼을 옮기면 이 검증이 조용히 죽는다. 이동 시 함께 갱신할 것.
  const src = readFileSync(
    path.posix.join(process.cwd(), "src-tauri/src/menu.rs"),
    "utf8",
  );
  // 아이템별로 스팬을 끊어서 accelerator 매칭이 다음 `let workspace_` 아이템으로
  // 넘어가지 못하게 한다 — 이전엔 고정폭 200자 lazy 윈도우였는데, accelerator가
  // 없는 아이템이 추가되면 그 윈도우가 다음 아이템의 accelerator 를 대신 붙잡아
  // 엉뚱한 id 에 귀속시켰다(§343 fix round 1).
  const spans = src.split(/(?=let workspace_)/);
  const accel: Record<string, string> = {};
  for (const span of spans) {
    const idMatch = /^let workspace_(\w+) = MenuItemBuilder/.exec(span);
    if (!idMatch) continue;
    const accelMatch = /\.accelerator\("([^"]+)"\)/.exec(span);
    if (accelMatch) accel[idMatch[1]] = accelMatch[1];
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
