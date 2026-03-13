// §72c Skill Optimize Prompt — build LLM prompt for skill optimization suggestions

export interface OptimizeSuggestion {
  after: null | string;
  before: null | string;
  category: "clarity" | "efficiency" | "missing" | "variables";
  description: string;
  title: string;
}

export function buildOptimizePrompt(skillContent: string): string {
  return `You are a prompt engineering expert. Analyze this skill file and suggest improvements.

Skill file:
---
${skillContent}
---

Provide 3-5 actionable suggestions as JSON array:
[
  {
    "category": "clarity" | "efficiency" | "missing" | "variables",
    "title": "short title",
    "description": "what to improve and why",
    "before": "current problematic text (or null)",
    "after": "suggested replacement (or null)"
  }
]

Focus on: unclear instructions, token waste, missing constraints, better variable usage.
Return ONLY the JSON array.`;
}

export function parseOptimizeResponse(raw: string): OptimizeSuggestion[] {
  try {
    // Extract JSON array from response (might have surrounding text)
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: unknown) =>
        typeof s === "object" &&
        s !== null &&
        "category" in s &&
        "title" in s &&
        "description" in s,
    ) as OptimizeSuggestion[];
  } catch {
    return [];
  }
}
