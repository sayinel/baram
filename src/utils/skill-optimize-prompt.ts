// §72c Skill Optimize Prompt — build LLM prompt for skill optimization suggestions

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

export interface OptimizeSuggestion {
  category: "clarity" | "efficiency" | "missing" | "variables";
  title: string;
  description: string;
  before: string | null;
  after: string | null;
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
