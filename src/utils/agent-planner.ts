// §11.6 Agent Planner — build LLM prompts and parse plan responses

import type { AgentPlan, AgentStep, RiskLevel } from "../stores/agent-store";

interface RawStep {
  action?: string;
  description?: string;
  file?: string;
  risk?: string;
}

const VALID_RISKS = new Set<string>(["high", "low", "medium"]);

/**
 * Build a planner prompt for the LLM to generate an execution plan.
 * Includes the user goal, file list, and requests JSON output.
 */
export function buildPlannerPrompt(goal: string, files: string[]): string {
  const fileList =
    files.length > 0
      ? `\nTarget files:\n${files.map((f) => `- ${f}`).join("\n")}`
      : "";

  return `You are an agent planner. Given the user's goal, create an execution plan.

Goal: ${goal}
${fileList}

Respond with a JSON object in the following format:
{
  "goal": "<goal summary>",
  "steps": [
    {
      "file": "<file path>",
      "action": "update" | "create" | "delete",
      "description": "<what to do>",
      "risk": "low" | "medium" | "high"
    }
  ]
}

Return ONLY valid JSON, no markdown fences or extra text.`;
}

/**
 * Parse an LLM response into a structured plan.
 * Throws if the response is not valid JSON or missing required fields.
 */
export function parsePlanResponse(response: string): AgentPlan {
  // Try to extract JSON from potential markdown fences
  let jsonStr = response.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const parsed: unknown = JSON.parse(jsonStr);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Plan response must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const rawSteps = obj.steps;

  if (!Array.isArray(rawSteps)) {
    throw new Error('Plan response must contain a "steps" array');
  }

  const steps: AgentStep[] = rawSteps.map((raw: RawStep, i: number) => {
    if (!raw.file || typeof raw.file !== "string") {
      throw new Error(`Step ${i} missing required "file" field`);
    }
    return {
      action: typeof raw.action === "string" ? raw.action : "update",
      description: typeof raw.description === "string" ? raw.description : "",
      file: raw.file,
      risk: (typeof raw.risk === "string" && VALID_RISKS.has(raw.risk)
        ? raw.risk
        : "low") as RiskLevel,
    };
  });

  return { steps };
}
