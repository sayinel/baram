import { describe, expect, it } from "vitest";

import { buildCommands } from "../command-registry";

const noopDeps = {
  onCloseFolder: () => {},
  onNewFile: () => {},
  onOpenFile: () => {},
  onOpenFolder: () => {},
  onSave: () => {},
  onSkillPreview: () => {},
  toggleSidebar: () => {},
  toggleSourceMode: () => {},
};

const EXPECTED: Record<string, string[]> = {
  ai: [
    "ai:expand",
    "ai:explain",
    "ai:fix-grammar",
    "ai:summarize",
    "ai:translate",
    // Both call `useLLMStream`, and the app's own label prefixes them
    // "AI:" — unlike `skills-preview` (assembles input, never calls the
    // LLM) and `skill:gallery` (opens a sidebar panel only), which stay
    // untagged. Both sit under category: "Skills", not "AI" — a category-
    // based filter would catch the five ai:* ids above but miss these two.
    "skill:generate",
    "skill:test",
  ],
  journal: ["journal:open-today", "workspace:journal"],
  tasks: ["tasks:weekly-review"],
  zettelkasten: [
    "workspace:zettelkasten",
    "zettelkasten:new-from-selection",
    "zettelkasten:new-moc",
    "zettelkasten:new-note",
    "zettelkasten:promote",
  ],
};

describe("palette feature tagging (§338)", () => {
  it("tags exactly the commands the spec lists", () => {
    const tagged = buildCommands(noopDeps).filter((c) => c.feature);
    // 개수 + 집합을 함께 고정한다 — 열거 목록만 늘리는 테스트는 다음 멤버를 놓친다
    expect(tagged).toHaveLength(15);
    for (const [feature, ids] of Object.entries(EXPECTED)) {
      expect(
        tagged
          .filter((c) => c.feature === feature)
          .map((c) => c.id)
          .sort(),
      ).toEqual(ids);
    }
  });

  it("does not rely on category as a proxy for feature", () => {
    // ‼️ 제텔 커맨드 4개가 category: "Journal" 아래 있고, 퍼스펙티브 진입 2개는
    // category: "Perspective" 다. 카테고리로 필터하면 오분류된다 (§337-(1)).
    const cmds = buildCommands(noopDeps);
    const zettelNewNote = cmds.find((c) => c.id === "zettelkasten:new-note");
    expect(zettelNewNote?.category).toBe("Journal");
    expect(zettelNewNote?.feature).toBe("zettelkasten");

    const wsJournal = cmds.find((c) => c.id === "workspace:journal");
    expect(wsJournal?.category).toBe("Perspective");
    expect(wsJournal?.feature).toBe("journal");
  });

  it("leaves feature-agnostic commands untagged", () => {
    const cmds = buildCommands(noopDeps);
    expect(cmds.find((c) => c.id === "file:new")?.feature).toBeUndefined();

    // §338 — these two sit in the same "Skills" category as skill:generate
    // and skill:test, but neither calls the LLM: skills-preview assembles
    // input without sending it (useful precisely when AI is unreachable),
    // and skill:gallery only opens a sidebar panel. A regression that gates
    // by category instead of by call site would wrongly tag these too.
    expect(
      cmds.find((c) => c.id === "skills-preview")?.feature,
    ).toBeUndefined();
    expect(cmds.find((c) => c.id === "skill:gallery")?.feature).toBeUndefined();
  });
});
