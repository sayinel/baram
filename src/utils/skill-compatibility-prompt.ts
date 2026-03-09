// §72b Task 4 — AI compatibility analysis prompt builder
import type { SkillMeta } from "./skill-dependency-analyzer";

export interface CompatibilityCheckRequest {
  sourceSkill: SkillMeta;
  targetSkill: SkillMeta;
}

/**
 * Build a prompt for LLM-based interface compatibility analysis.
 * Compares the output_format of the source skill with the expected input of the target skill.
 */
export function buildCompatibilityPrompt(
  req: CompatibilityCheckRequest,
): string {
  const { sourceSkill, targetSkill } = req;

  return `You are a skill dependency analyzer. Analyze whether the output of skill "${sourceSkill.name}" is compatible with what skill "${targetSkill.name}" expects as input.

Source skill "${sourceSkill.name}":
- output_format: ${sourceSkill.outputFormat || "(not specified)"}
- description: ${sourceSkill.description || "(not specified)"}

Target skill "${targetSkill.name}":
- output_format: ${targetSkill.outputFormat || "(not specified)"}
- description: ${targetSkill.description || "(not specified)"}
- requires: [${targetSkill.requires.join(", ")}]

Evaluate:
1. Are the output/input formats compatible?
2. If not, what specific mismatch exists?
3. How could the interface be fixed?

Respond in JSON:
{
  "compatible": true/false,
  "confidence": "high"/"medium"/"low",
  "mismatch": "description of mismatch or null",
  "suggestion": "fix suggestion or null"
}`;
}

export interface CompatibilityResult {
  compatible: boolean;
  confidence: "high" | "medium" | "low";
  mismatch: string | null;
  suggestion: string | null;
}

/**
 * Parse LLM response into a typed CompatibilityResult.
 * Falls back to a safe default on parse failure.
 */
export function parseCompatibilityResponse(raw: string): CompatibilityResult {
  try {
    // Extract JSON from potential markdown code block
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      compatible: Boolean(parsed.compatible),
      confidence: ["high", "medium", "low"].includes(parsed.confidence)
        ? parsed.confidence
        : "low",
      mismatch: parsed.mismatch ?? null,
      suggestion: parsed.suggestion ?? null,
    };
  } catch {
    return {
      compatible: false,
      confidence: "low",
      mismatch: "Failed to parse AI response",
      suggestion: null,
    };
  }
}
