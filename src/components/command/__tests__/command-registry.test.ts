// The command palette is English-only: `command-registry.ts` calls `t()` exactly
// zero times and every category is an English word. Three workspace entries were
// written in Korean anyway, so an English UI showed 화면구성 in the palette and a
// search for "Workspace" — or "Perspective" — found nothing.
//
// The guard scans rather than enumerates. Naming the three offenders would let the
// fourth one through, and the whole point is that nobody noticed these three.
import type { CommandDeps } from "../command-registry";

import { describe, expect, it } from "vitest";

import { KEYBINDING_REGISTRY } from "../../../keybindings/keybinding-registry";
import { BUILTIN_PRESETS } from "../../../stores/file/workspace";
import { buildCommands } from "../command-registry";

const noop = () => {};
const DEPS: CommandDeps = {
  onCloseFolder: noop,
  onNewFile: noop,
  onOpenFile: noop,
  onOpenFolder: noop,
  onSave: noop,
  onSkillPreview: noop,
  toggleSidebar: noop,
  toggleSourceMode: noop,
};

const HANGUL = /[가-힣]/;

describe("command registry — palette text is English", () => {
  it("has no Hangul in any string a command carries", () => {
    // Every string field, not a named few: `CommandItem` gains fields over time
    // and a guard that lists today's would not look at tomorrow's.
    const offenders = buildCommands(DEPS).flatMap((command) =>
      Object.entries(command)
        .filter(([, value]) => typeof value === "string" && HANGUL.test(value))
        .map(([field, value]) => `${command.id}.${field}: ${value}`),
    );

    expect(offenders).toEqual([]);
  });
});

describe("command registry — perspectives", () => {
  it("registers all four perspectives the app ships", () => {
    const perspectives = buildCommands(DEPS)
      .filter((c) => c.category === "Perspective")
      .map((c) => c.label)
      .sort();

    expect(perspectives).toEqual([
      "Journal Perspective",
      "Skills Perspective",
      "Writing Perspective",
      "Zettel Perspective",
    ]);
  });
});

// The palette wrote its shortcuts as literals while the bindings live in
// `keybinding-registry.ts`, and the two drifted: the palette offered ⌥⌘2 for the
// Journal perspective, which is the key bound to Zettel. Following the palette
// took you to the wrong space. Derive the digit from the binding so the literal
// cannot claim a neighbour's key again.
//
// Only the digit is derived. `formatKeyForDisplay` renders ⌘⌥N, while the palette
// (and Apple's own order, ⌃⌥⇧⌘) writes ⌥⌘N — that difference is a separate
// question and not one this test should decide.
describe("command registry — a perspective's shortcut is the one bound to it", () => {
  const PALETTE_TO_BINDING: Record<string, string> = {
    "workspace:journal": "workspace.journal",
    "workspace:skills": "workspace.skills",
    "workspace:writing": "workspace.writing",
    "workspace:zettelkasten": "workspace.zettelkasten",
  };

  it("takes the digit from the keybinding registry, not from a literal", () => {
    const commands = new Map(buildCommands(DEPS).map((c) => [c.id, c]));

    for (const [commandId, bindingId] of Object.entries(PALETTE_TO_BINDING)) {
      const binding = KEYBINDING_REGISTRY.find((b) => b.id === bindingId);
      expect(binding, `no keybinding named ${bindingId}`).toBeDefined();
      const digit = binding?.defaultKey.split("+").pop();

      expect(commands.get(commandId)?.shortcut).toBe(`⌥⌘${digit}`);
    }
  });

  // §343/M-9 — 숫자만 파생돼 있었고 **순서**는 리터럴 배치였다. 팔레트는 퍼스펙티브를
  // 나열하는 네 표면 중 하나이고, 나머지 셋(keybinding-registry · menu.rs · 상태바
  // 드롭다운)은 `perspective-order.test.ts` 와 `workspace-store.test.ts` 가 고정한다.
  // 정본은 `BUILTIN_PRESETS` 하나뿐이므로 여기서도 그것에서 파생시킨다 — 리터럴을
  // 또 적으면 이 파일이 다섯 번째 사본이 된다.
  it("lists the perspectives in BUILTIN_PRESETS order, not a literal order", () => {
    const palette = buildCommands(DEPS)
      .filter((c) => c.category === "Perspective")
      .map((c) => c.id.replace(/^workspace:/, ""));

    expect(palette).toEqual(BUILTIN_PRESETS.map((p) => p.id));
  });
});
