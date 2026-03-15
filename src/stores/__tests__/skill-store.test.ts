import { beforeEach, describe, expect, it } from "vitest";

import { useSkillStore } from "../ai/skill";

describe("skill-store", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSkillStore.setState({
      isSkill: false,
      currentSkill: null,
      allSkills: [],
      lintResults: [],
      dependencyWarnings: [],
      scanning: false,
    });
  });

  it("initial state should have empty arrays and false flags", () => {
    const state = useSkillStore.getState();
    expect(state.isSkill).toBe(false);
    expect(state.currentSkill).toBeNull();
    expect(state.allSkills).toEqual([]);
    expect(state.lintResults).toEqual([]);
    expect(state.dependencyWarnings).toEqual([]);
    expect(state.scanning).toBe(false);
  });

  describe("updateCurrentFile", () => {
    it("detects skill file with name and description in frontmatter", () => {
      const yaml = "name: My Skill\ndescription: A test skill\nversion: 1.0";
      useSkillStore.getState().updateCurrentFile(yaml, "/skills/my-skill.md");

      const state = useSkillStore.getState();
      expect(state.isSkill).toBe(true);
      expect(state.currentSkill).not.toBeNull();
      expect(state.currentSkill!.name).toBe("My Skill");
      expect(state.currentSkill!.filePath).toBe("/skills/my-skill.md");
      expect(state.currentSkill!.description).toBe("A test skill");
      expect(state.currentSkill!.version).toBe("1.0");
    });

    it("detects skill file with requires array", () => {
      const yaml =
        "name: Composite Skill\ndescription: Uses others\nrequires: [skill-a, skill-b]";
      useSkillStore.getState().updateCurrentFile(yaml, "/skills/composite.md");

      const state = useSkillStore.getState();
      expect(state.isSkill).toBe(true);
      expect(state.currentSkill!.requires).toEqual(["skill-a", "skill-b"]);
    });

    it("sets isSkill=false for non-skill file (missing name)", () => {
      const yaml = "description: Just a description\ntags: [test]";
      useSkillStore.getState().updateCurrentFile(yaml, "/notes/note.md");

      const state = useSkillStore.getState();
      expect(state.isSkill).toBe(false);
      expect(state.currentSkill).toBeNull();
    });

    it("sets isSkill=false for non-skill file (missing description)", () => {
      const yaml = "name: Just a Name\ntags: [test]";
      useSkillStore.getState().updateCurrentFile(yaml, "/notes/note.md");

      const state = useSkillStore.getState();
      expect(state.isSkill).toBe(false);
      expect(state.currentSkill).toBeNull();
    });

    it("sets isSkill=false for empty yaml", () => {
      useSkillStore.getState().updateCurrentFile("", "/notes/empty.md");

      const state = useSkillStore.getState();
      expect(state.isSkill).toBe(false);
      expect(state.currentSkill).toBeNull();
    });

    it("transitions from skill to non-skill correctly", () => {
      // First set as skill
      useSkillStore
        .getState()
        .updateCurrentFile("name: Skill\ndescription: Test", "/skills/test.md");
      expect(useSkillStore.getState().isSkill).toBe(true);

      // Then switch to non-skill
      useSkillStore
        .getState()
        .updateCurrentFile("title: Just a note", "/notes/note.md");
      expect(useSkillStore.getState().isSkill).toBe(false);
      expect(useSkillStore.getState().currentSkill).toBeNull();
    });
  });

  describe("setLintResults", () => {
    it("updates lintResults array", () => {
      const results = [
        {
          rule: "ambiguousInstruction",
          message: "Vague word",
          from: 10,
          to: 14,
          severity: "warning" as const,
        },
        {
          rule: "missingOutputFormat",
          message: "No format",
          from: 0,
          to: 3,
          severity: "warning" as const,
        },
      ];
      useSkillStore.getState().setLintResults(results);

      const state = useSkillStore.getState();
      expect(state.lintResults).toHaveLength(2);
      expect(state.lintResults[0].rule).toBe("ambiguousInstruction");
      expect(state.lintResults[1].rule).toBe("missingOutputFormat");
    });

    it("replaces previous results", () => {
      useSkillStore.getState().setLintResults([
        {
          rule: "old",
          message: "Old result",
          from: 0,
          to: 1,
          severity: "warning",
        },
      ]);
      expect(useSkillStore.getState().lintResults).toHaveLength(1);

      useSkillStore.getState().setLintResults([
        { rule: "new1", message: "New 1", from: 0, to: 1, severity: "error" },
        {
          rule: "new2",
          message: "New 2",
          from: 5,
          to: 10,
          severity: "warning",
        },
      ]);
      expect(useSkillStore.getState().lintResults).toHaveLength(2);
      expect(useSkillStore.getState().lintResults[0].rule).toBe("new1");
    });

    it("can be cleared with empty array", () => {
      useSkillStore.getState().setLintResults([
        {
          rule: "test",
          message: "Test",
          from: 0,
          to: 1,
          severity: "warning",
        },
      ]);
      expect(useSkillStore.getState().lintResults).toHaveLength(1);

      useSkillStore.getState().setLintResults([]);
      expect(useSkillStore.getState().lintResults).toEqual([]);
    });
  });
});
