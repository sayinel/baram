// §46 Prompt Lint — unit tests for each linter rule
import { describe, expect, test } from "vitest";

import { lintPrompt, rules } from "../../utils/prompt-linter";

describe("§46 Prompt Linter", () => {
  // --- ambiguousInstruction ---
  describe("ambiguousInstruction", () => {
    test("detects vague words in body", () => {
      const text = `---
name: test
type: skill
description: test
---

Write a good summary of the text.`;
      const results = rules.checkAmbiguousInstruction(text);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].rule).toBe("ambiguousInstruction");
      expect(results[0].message).toContain("good");
      expect(results[0].severity).toBe("warning");
    });

    test("detects multiple vague words", () => {
      const text = `---
name: test
type: skill
description: test
---

Write a nice and appropriate response.`;
      const results = rules.checkAmbiguousInstruction(text);
      expect(results.length).toBe(2);
      const words = results.map((r) => r.message);
      expect(words.some((m) => m.includes("nice"))).toBe(true);
      expect(words.some((m) => m.includes("appropriate"))).toBe(true);
    });

    test("no false positive for specific instructions", () => {
      const text = `---
name: test
type: skill
description: test
---

Summarize in 3 bullet points using formal tone.`;
      const results = rules.checkAmbiguousInstruction(text);
      expect(results.length).toBe(0);
    });

    test("ignores vague words in frontmatter", () => {
      const text = `---
name: good-skill
type: skill
description: A good skill
---

Be precise.`;
      // "good" appears in frontmatter, not body
      const results = rules.checkAmbiguousInstruction(text);
      expect(results.length).toBe(0);
    });
  });

  // --- missingOutputFormat ---
  describe("missingOutputFormat", () => {
    test("warns when no output_format anywhere", () => {
      const text = `---
name: test
type: skill
description: test
---

<system>
Do something.
</system>`;
      const results = rules.checkMissingOutputFormat(text);
      expect(results.length).toBe(1);
      expect(results[0].rule).toBe("missingOutputFormat");
      expect(results[0].severity).toBe("warning");
    });

    test("no warning when output_format in frontmatter", () => {
      const text = `---
name: test
type: skill
description: test
output_format: json
---

Do something.`;
      const results = rules.checkMissingOutputFormat(text);
      expect(results.length).toBe(0);
    });

    test("no warning when format instruction in body", () => {
      const text = `---
name: test
type: skill
description: test
---

Output format: JSON with keys summary and details.`;
      const results = rules.checkMissingOutputFormat(text);
      expect(results.length).toBe(0);
    });
  });

  // --- missingRequiredField ---
  describe("missingRequiredField", () => {
    test("reports missing name field", () => {
      const text = `---
type: skill
description: test
---

Body.`;
      const results = rules.checkMissingRequiredField(text);
      expect(results.some((r) => r.message.includes('"name"'))).toBe(true);
      expect(results[0].severity).toBe("error");
    });

    test("reports missing description field", () => {
      const text = `---
name: test
type: skill
---

Body.`;
      const results = rules.checkMissingRequiredField(text);
      expect(results.some((r) => r.message.includes('"description"'))).toBe(
        true,
      );
    });

    test("reports both missing fields", () => {
      const text = `---
type: skill
---

Body.`;
      const results = rules.checkMissingRequiredField(text);
      expect(results.length).toBe(2);
    });

    test("no error when all fields present", () => {
      const text = `---
name: test
type: skill
description: test
---

Body.`;
      const results = rules.checkMissingRequiredField(text);
      expect(results.length).toBe(0);
    });
  });

  // --- excessiveLength ---
  describe("excessiveLength", () => {
    test("warns when body exceeds 4000 chars", () => {
      const frontmatter = `---
name: test
type: skill
description: test
---
`;
      const body = "x".repeat(4100);
      const text = frontmatter + body;
      const results = rules.checkExcessiveLength(text);
      expect(results.length).toBe(1);
      expect(results[0].rule).toBe("excessiveLength");
      expect(results[0].severity).toBe("warning");
    });

    test("no warning for short body", () => {
      const text = `---
name: test
type: skill
description: test
---

Short body.`;
      const results = rules.checkExcessiveLength(text);
      expect(results.length).toBe(0);
    });
  });

  // --- unusedVariable ---
  describe("unusedVariable", () => {
    test("warns about unused declared variables", () => {
      const text = `---
name: test
type: skill
description: test
variables: [selection, input]
---

<user>
Only uses {{selection}} here.
</user>`;
      const results = rules.checkUnusedVariable(text);
      expect(results.length).toBe(1);
      expect(results[0].rule).toBe("unusedVariable");
      expect(results[0].message).toContain("input");
    });

    test("no warning when all variables used", () => {
      const text = `---
name: test
type: skill
description: test
variables: [selection, input]
---

<user>
{{selection}} and {{input}}
</user>`;
      const results = rules.checkUnusedVariable(text);
      expect(results.length).toBe(0);
    });

    test("no warning without variables declaration", () => {
      const text = `---
name: test
type: skill
description: test
---

<user>
{{selection}}
</user>`;
      const results = rules.checkUnusedVariable(text);
      expect(results.length).toBe(0);
    });
  });

  // --- conflictingInstructions ---
  describe("conflictingInstructions", () => {
    test("detects be concise + provide detailed conflict", () => {
      const text = `---
name: test
type: skill
description: test
---

<system>
Be concise in your response. But also provide detailed explanations.
</system>`;
      const results = rules.checkConflictingInstructions(text);
      expect(results.length).toBe(1);
      expect(results[0].rule).toBe("conflictingInstructions");
      expect(results[0].severity).toBe("warning");
    });

    test("no conflict for non-contradictory instructions", () => {
      const text = `---
name: test
type: skill
description: test
---

<system>
Be concise and accurate.
</system>`;
      const results = rules.checkConflictingInstructions(text);
      expect(results.length).toBe(0);
    });
  });

  // --- lintPrompt (integration) ---
  describe("lintPrompt integration", () => {
    test("returns combined results from all rules", () => {
      const text = `---
type: skill
---

Write a good response. Be concise. But also provide detailed analysis.`;
      const results = lintPrompt(text);
      const ruleNames = new Set(results.map((r) => r.rule));
      // Should have: ambiguousInstruction (good), missingRequiredField (name, description),
      // missingOutputFormat, conflictingInstructions
      expect(ruleNames.has("ambiguousInstruction")).toBe(true);
      expect(ruleNames.has("missingRequiredField")).toBe(true);
    });

    test("returns empty for well-formed Skill", () => {
      const text = `---
name: summarizer
type: skill
description: Summarizes text
output_format: text
---

<system>
Summarize the given text in 3 bullet points.
</system>

<user>
{{selection}}
</user>`;
      const results = lintPrompt(text);
      expect(results.length).toBe(0);
    });

    test("returns empty for non-frontmatter text", () => {
      const results = lintPrompt("# Just a heading\nSome regular text.");
      // No frontmatter → most rules skip
      expect(results.length).toBe(0);
    });
  });
});
