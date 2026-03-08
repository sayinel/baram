import { rules } from "../prompt-linter";

const skillTemplate = (requires: string) =>
  `---\nname: test\ntype: skill\ndescription: test\nrequires: ${requires}\n---\n\n<system>Test</system>`;

describe("checkEmptyRequires", () => {
  it("warns on empty entries", () => {
    const text = skillTemplate("[a, , b]");
    const results = rules.checkEmptyRequires(text);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("emptyRequires");
  });

  it("no warning for valid requires", () => {
    const text = skillTemplate("[a, b]");
    const results = rules.checkEmptyRequires(text);
    expect(results).toEqual([]);
  });

  it("no warning without requires", () => {
    const text = "---\nname: test\ntype: skill\n---\n\nBody";
    const results = rules.checkEmptyRequires(text);
    expect(results).toEqual([]);
  });
});

describe("checkDuplicateRequires", () => {
  it("warns on duplicate entries", () => {
    const text = skillTemplate("[a, b, a]");
    const results = rules.checkDuplicateRequires(text);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain("a");
  });

  it("no warning for unique requires", () => {
    const text = skillTemplate("[a, b, c]");
    const results = rules.checkDuplicateRequires(text);
    expect(results).toEqual([]);
  });
});
