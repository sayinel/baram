// §11.6 Agent Executor — sequential step execution with risk checks

import { useAgentStore } from "../stores/agent-store";
import { detectRisk } from "./agent-risk-detector";

interface ExecutorDeps {
  /** Send prompt + content to LLM, returns modified content */
  llmFn: (prompt: string, fileContent: string) => Promise<string>;
  /** Read file content by path */
  readFileFn: (path: string) => Promise<string>;
}

/**
 * Execute the agent plan step by step.
 *
 * For each step: read file -> send to LLM -> generate diff -> risk check -> store result.
 * Pauses on medium/high risk. Tracks progress in agent store.
 *
 * @param deps - Injectable dependencies for file reading and LLM calls (for testing)
 */
export async function executeAgentPlan(deps: ExecutorDeps): Promise<void> {
  const store = useAgentStore.getState();
  const plan = store.plan;

  if (!plan || store.status !== "executing") return;

  for (let i = 0; i < plan.steps.length; i++) {
    // Re-check status in case we were cancelled or paused externally
    const currentStatus = useAgentStore.getState().status;
    if (currentStatus !== "executing") return;

    const step = plan.steps[i];

    try {
      // Read the original file content
      const original = await deps.readFileFn(step.file);

      // Send to LLM for modification
      const modified = await deps.llmFn(
        `${store.goal}\n\nFile: ${step.file}\nAction: ${step.action}\nDescription: ${step.description ?? ""}`,
        original,
      );

      // Check risk level of the changes
      const risk = detectRisk(original, modified);

      // Generate diff
      const diff = generateDiff(step.file, original, modified);

      // Store the result
      useAgentStore
        .getState()
        .completeStep(i, { diff, file: step.file, accepted: null });

      // Pause on medium/high risk
      if (risk === "medium" || risk === "high") {
        useAgentStore
          .getState()
          .pauseOnRisk(`Step ${i + 1} (${step.file}): ${risk} risk detected`);
        return;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      useAgentStore
        .getState()
        .pauseOnRisk(`Step ${i + 1} (${step.file}) failed: ${message}`);
      return;
    }
  }

  // All steps completed successfully
  useAgentStore.getState().finish();
}

/**
 * Generate a simple unified diff between original and modified content.
 */
function generateDiff(
  file: string,
  original: string,
  modified: string,
): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const diffLines: string[] = [`--- a/${file}`, `+++ b/${file}`];

  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i];
    const modLine = modLines[i];
    if (origLine === modLine) {
      diffLines.push(` ${origLine ?? ""}`);
    } else {
      if (origLine !== undefined) diffLines.push(`-${origLine}`);
      if (modLine !== undefined) diffLines.push(`+${modLine}`);
    }
  }

  return diffLines.join("\n");
}
