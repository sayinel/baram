import { isSkillFrontmatter } from "../use-skills-mode";

describe("isSkillFrontmatter", () => {
  it("detects name + description", () => {
    expect(isSkillFrontmatter("name: test\ndescription: a skill")).toBe(true);
  });
  it("detects with extra fields", () => {
    expect(isSkillFrontmatter("name: test\nversion: 1.0\ndescription: a skill\ntags: [a]")).toBe(true);
  });
  it("returns false without description", () => {
    expect(isSkillFrontmatter("name: test\nversion: 1.0")).toBe(false);
  });
  it("returns false without name", () => {
    expect(isSkillFrontmatter("description: a skill\nversion: 1.0")).toBe(false);
  });
  it("returns false for empty", () => {
    expect(isSkillFrontmatter("")).toBe(false);
  });
  it("rejects name/description inside a value", () => {
    // "tags: name: foo" — "name" is NOT at key position
    expect(isSkillFrontmatter("tags: name: foo\nother: description: bar")).toBe(false);
  });
});
