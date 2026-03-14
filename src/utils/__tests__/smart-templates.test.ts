// §11.8 Smart Templates — built-in template schemas
import { describe, expect, it } from "vitest";

import {
  buildTemplatePrompt,
  getBuiltinTemplates,
  getTemplateById,
} from "../smart-templates";

describe("Smart Templates", () => {
  it("provides 7 built-in templates", () => {
    expect(getBuiltinTemplates()).toHaveLength(7);
  });

  it("each template has id, name, sections, contextHints", () => {
    for (const tmpl of getBuiltinTemplates()) {
      expect(tmpl).toHaveProperty("id");
      expect(tmpl).toHaveProperty("name");
      expect(tmpl).toHaveProperty("sections");
      expect(tmpl.sections.length).toBeGreaterThan(0);
    }
  });

  it("getTemplateById returns correct template", () => {
    const tmpl = getTemplateById("api-doc");
    expect(tmpl?.name).toBe("API Documentation");
  });

  it("buildTemplatePrompt includes template sections and context", () => {
    const prompt = buildTemplatePrompt("api-doc", {
      projectName: "Baram",
      techStack: "Tauri + React",
    });
    expect(prompt).toContain("API Documentation");
    expect(prompt).toContain("Baram");
  });
});
