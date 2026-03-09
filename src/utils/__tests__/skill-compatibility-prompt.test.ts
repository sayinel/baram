import { describe, it, expect } from "vitest";
import {
  buildCompatibilityPrompt,
  parseCompatibilityResponse,
} from "../skill-compatibility-prompt";
import type { SkillMeta } from "../skill-dependency-analyzer";

describe("buildCompatibilityPrompt", () => {
  const source: SkillMeta = {
    name: "summarizer",
    filePath: "/skills/summarizer.md",
    requires: [],
    outputFormat: "markdown",
    description: "Summarizes text",
  };
  const target: SkillMeta = {
    name: "translator",
    filePath: "/skills/translator.md",
    requires: ["summarizer"],
    outputFormat: "json",
    description: "Translates text",
  };

  it("includes both skill names and formats", () => {
    const prompt = buildCompatibilityPrompt({ sourceSkill: source, targetSkill: target });
    expect(prompt).toContain("summarizer");
    expect(prompt).toContain("translator");
    expect(prompt).toContain("markdown");
    expect(prompt).toContain("json");
  });

  it("handles missing output_format", () => {
    const noFormat: SkillMeta = { ...source, outputFormat: "" };
    const prompt = buildCompatibilityPrompt({ sourceSkill: noFormat, targetSkill: target });
    expect(prompt).toContain("(not specified)");
  });
});

describe("parseCompatibilityResponse", () => {
  it("parses valid JSON response", () => {
    const raw = '{"compatible": true, "confidence": "high", "mismatch": null, "suggestion": null}';
    const result = parseCompatibilityResponse(raw);
    expect(result.compatible).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.mismatch).toBeNull();
  });

  it("extracts JSON from markdown code block", () => {
    const raw = '```json\n{"compatible": false, "confidence": "medium", "mismatch": "format differs", "suggestion": "use json"}\n```';
    const result = parseCompatibilityResponse(raw);
    expect(result.compatible).toBe(false);
    expect(result.mismatch).toBe("format differs");
  });

  it("returns safe fallback on invalid input", () => {
    const result = parseCompatibilityResponse("not json at all");
    expect(result.compatible).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.mismatch).toContain("Failed to parse");
  });
});
