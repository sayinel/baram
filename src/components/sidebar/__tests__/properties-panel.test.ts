import {
  parseYamlProperties,
  serializeYamlProperties,
} from "../../../utils/yaml-properties";

describe("parseYamlProperties", () => {
  it("parses string fields", () => {
    const result = parseYamlProperties(
      "name: test-skill\ndescription: A skill",
    );
    expect(result).toContainEqual({
      key: "name",
      value: "test-skill",
      type: "string",
    });
    expect(result).toContainEqual({
      key: "description",
      value: "A skill",
      type: "string",
    });
  });

  it("parses array fields (bracket syntax)", () => {
    const result = parseYamlProperties("tags: [code-gen, tiptap]");
    expect(result).toContainEqual({
      key: "tags",
      value: ["code-gen", "tiptap"],
      type: "array",
    });
  });

  it("parses known array keys even without brackets", () => {
    const result = parseYamlProperties("tags: code-gen");
    // tags is a known array key, but single value without brackets → still treated as array
    expect(result.find((e) => e.key === "tags")?.type).toBe("array");
  });

  it("parses status as enum", () => {
    const result = parseYamlProperties("status: draft");
    expect(result).toContainEqual({
      key: "status",
      value: "draft",
      type: "enum",
    });
  });

  it("parses empty array", () => {
    const result = parseYamlProperties("tags: []");
    expect(result).toContainEqual({ key: "tags", value: [], type: "array" });
  });

  it("handles empty string", () => {
    expect(parseYamlProperties("")).toEqual([]);
    expect(parseYamlProperties("  ")).toEqual([]);
  });

  it("roundtrips through serialize", () => {
    const yaml = "name: test\ndescription: desc\ntags: [a, b]\nstatus: draft";
    const props = parseYamlProperties(yaml);
    const out = serializeYamlProperties(props);
    expect(out).toBe(yaml);
  });
});
