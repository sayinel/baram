// §11.3.1 Writing Mode System Prompts — common preamble + mode-specific appendix
import { describe, expect, it } from "vitest";

import { getSystemPromptForMode } from "../writing-mode-prompts";

describe("getSystemPromptForMode", () => {
  it("includes common preamble for all modes", () => {
    for (const mode of [
      "technical",
      "academic",
      "creative",
      "skills",
      "journal",
      "notes",
      "general",
    ] as const) {
      const prompt = getSystemPromptForMode(mode);
      expect(prompt).toContain("Continue the user's text naturally");
    }
  });

  it("includes technical-specific instructions for technical mode", () => {
    const prompt = getSystemPromptForMode("technical");
    expect(prompt).toContain("technical terminology");
  });

  it("includes academic-specific instructions for academic mode", () => {
    const prompt = getSystemPromptForMode("academic");
    expect(prompt).toContain("formal academic");
  });

  it("includes skills-specific instructions for skills mode", () => {
    const prompt = getSystemPromptForMode("skills");
    expect(prompt).toContain("XML");
  });
});
