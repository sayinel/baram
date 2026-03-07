import { isSkillFrontmatter } from "../use-skills-mode";

describe("isSkillFrontmatter", () => {
  it("detects type: skill", () => {
    expect(isSkillFrontmatter("name: test\ntype: skill\n")).toBe(true);
  });
  it("case insensitive", () => {
    expect(isSkillFrontmatter("type: Skill")).toBe(true);
  });
  it("returns false for non-skill", () => {
    expect(isSkillFrontmatter("type: note")).toBe(false);
    expect(isSkillFrontmatter("")).toBe(false);
  });
  it("rejects type: skill inside a value", () => {
    // "description: type: skill in body" — "type" is NOT at key position
    expect(isSkillFrontmatter("description: has type: skill inside")).toBe(false);
  });
});
