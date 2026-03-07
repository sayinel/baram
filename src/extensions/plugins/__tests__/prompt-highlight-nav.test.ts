import { extractFilePaths } from "../prompt-highlight";

describe("extractFilePaths", () => {
  it("extracts relative paths with ./", () => {
    const result = extractFilePaths("See ./agents/executor.md for details");
    expect(result).toContainEqual(
      expect.objectContaining({ path: "./agents/executor.md" }),
    );
  });

  it("extracts absolute-like paths with /", () => {
    const result = extractFilePaths("ref: /skills/base.md");
    // /skills/base.md has a leading / which matches ../. prefix pattern
    expect(result.length).toBeGreaterThan(0);
  });

  it("extracts bare relative paths (no prefix)", () => {
    const result = extractFilePaths("requires: agents/executor.md here");
    expect(result).toContainEqual(
      expect.objectContaining({ path: "agents/executor.md" }),
    );
  });

  it("returns empty for no paths", () => {
    expect(extractFilePaths("Hello world no paths")).toEqual([]);
  });

  it("extracts multiple paths", () => {
    const result = extractFilePaths("See ./a.md and ./b.ts files");
    expect(result).toHaveLength(2);
  });

  it("extracts ../relative paths", () => {
    const result = extractFilePaths("ref: ../shared/utils.ts");
    expect(result).toContainEqual(
      expect.objectContaining({ path: "../shared/utils.ts" }),
    );
  });
});
