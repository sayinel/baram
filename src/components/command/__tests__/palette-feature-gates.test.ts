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
    expect(tagged).toHaveLength(13);
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
  });
});
