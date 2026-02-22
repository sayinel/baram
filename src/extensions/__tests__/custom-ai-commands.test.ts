// §48 Custom AI Commands — unit tests
import { describe, test, expect } from "vitest";
import {
  substituteVariables,
  resolveInputVariable,
  substituteInput,
  generateCommandId,
} from "../../utils/custom-ai-commands";
import { extractSkillPrompt, runSkillTest } from "../../utils/skill-test-runner";

describe("§48 Custom AI Commands", () => {
  // --- substituteVariables ---

  test("substituteVariables replaces {{selection}}", () => {
    const result = substituteVariables("Summarize: {{selection}}", {
      selection: "Hello world",
    });
    expect(result).toBe("Summarize: Hello world");
  });

  test("substituteVariables replaces {{document}}", () => {
    const result = substituteVariables("Context: {{document}}", {
      document: "Full document content",
    });
    expect(result).toBe("Context: Full document content");
  });

  test("substituteVariables replaces {{clipboard}}", () => {
    const result = substituteVariables("Paste: {{clipboard}}", {
      clipboard: "clipboard data",
    });
    expect(result).toBe("Paste: clipboard data");
  });

  test("substituteVariables replaces multiple variables", () => {
    const template = "Selection: {{selection}}\nDoc: {{document}}\nClip: {{clipboard}}";
    const result = substituteVariables(template, {
      selection: "sel",
      document: "doc",
      clipboard: "clip",
    });
    expect(result).toBe("Selection: sel\nDoc: doc\nClip: clip");
  });

  test("substituteVariables uses empty string for missing context", () => {
    const result = substituteVariables("{{selection}} and {{document}}", {});
    expect(result).toBe(" and ");
  });

  test("substituteVariables does NOT replace {{input}}", () => {
    const result = substituteVariables("Enter: {{input}}", { selection: "test" });
    expect(result).toBe("Enter: {{input}}");
  });

  test("substituteVariables handles multiple occurrences", () => {
    const result = substituteVariables("{{selection}} then {{selection}}", {
      selection: "hi",
    });
    expect(result).toBe("hi then hi");
  });

  // --- resolveInputVariable ---

  test("resolveInputVariable detects {{input}}", () => {
    const result = resolveInputVariable("Transform: {{input}}");
    expect(result.hasInput).toBe(true);
    expect(result.prompt).toBe("Transform:");
  });

  test("resolveInputVariable returns false when no {{input}}", () => {
    const result = resolveInputVariable("Summarize: {{selection}}");
    expect(result.hasInput).toBe(false);
    expect(result.prompt).toBe("");
  });

  test("resolveInputVariable provides default prompt", () => {
    const result = resolveInputVariable("{{input}}");
    expect(result.hasInput).toBe(true);
    expect(result.prompt).toBe("Enter input:");
  });

  test("resolveInputVariable extracts context from surrounding text", () => {
    const result = resolveInputVariable("Please provide instructions: {{input}}");
    expect(result.hasInput).toBe(true);
    expect(result.prompt).toBe("Please provide instructions:");
  });

  // --- substituteInput ---

  test("substituteInput replaces {{input}} with value", () => {
    const result = substituteInput("Question: {{input}}", "What is AI?");
    expect(result).toBe("Question: What is AI?");
  });

  test("substituteInput handles multiple {{input}} occurrences", () => {
    const result = substituteInput("{{input}} and {{input}}", "test");
    expect(result).toBe("test and test");
  });

  // --- generateCommandId ---

  test("generateCommandId creates unique IDs", () => {
    const id1 = generateCommandId();
    const id2 = generateCommandId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^custom_\d+_[a-z0-9]+$/);
  });
});

describe("§47 Skill Test Runner", () => {
  const sampleSkill = `---
name: test-skill
type: skill
description: A test skill
---

<system>
You are a helpful assistant specialized in {{domain}}.
</system>

<user>
Please analyze the following:

{{selection}}

Additional context: {{input}}
</user>
`;

  test("extractSkillPrompt extracts system prompt", () => {
    const { system } = extractSkillPrompt(sampleSkill);
    expect(system).toBe("You are a helpful assistant specialized in {{domain}}.");
  });

  test("extractSkillPrompt extracts user prompt", () => {
    const { user } = extractSkillPrompt(sampleSkill);
    expect(user).toContain("Please analyze the following:");
    expect(user).toContain("{{selection}}");
    expect(user).toContain("{{input}}");
  });

  test("extractSkillPrompt finds all variables", () => {
    const { variables } = extractSkillPrompt(sampleSkill);
    expect(variables).toContain("domain");
    expect(variables).toContain("selection");
    expect(variables).toContain("input");
    expect(variables.length).toBe(3);
  });

  test("extractSkillPrompt handles missing blocks", () => {
    const { system, user, variables } = extractSkillPrompt("# Just a heading\nSome text");
    expect(system).toBe("");
    expect(user).toBe("");
    expect(variables).toEqual([]);
  });

  test("runSkillTest substitutes variables in prompts", () => {
    const { systemPrompt, userPrompt } = runSkillTest(sampleSkill, {
      domain: "code review",
      selection: "function foo() {}",
      input: "Check for bugs",
    });
    expect(systemPrompt).toBe("You are a helpful assistant specialized in code review.");
    expect(userPrompt).toContain("function foo() {}");
    expect(userPrompt).toContain("Check for bugs");
    expect(userPrompt).not.toContain("{{selection}}");
    expect(userPrompt).not.toContain("{{input}}");
  });

  test("runSkillTest leaves unsubstituted variables as-is", () => {
    const { systemPrompt } = runSkillTest(sampleSkill, {});
    expect(systemPrompt).toContain("{{domain}}");
  });
});
