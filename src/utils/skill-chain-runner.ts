// §72b Task 6 — Skill chain test runner
// Executes a sequence of skills in dependency order and validates output flow.

import type { SkillMeta } from "./skill-dependency-analyzer";
import { buildDependencyGraph, detectCycles } from "./skill-dependency-analyzer";

export type ChainStepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface ChainStep {
  skillName: string;
  status: ChainStepStatus;
  input?: string;
  output?: string;
  error?: string;
  durationMs?: number;
}

export interface ChainResult {
  steps: ChainStep[];
  success: boolean;
  totalDurationMs: number;
}

/**
 * Topological sort: returns execution order for a skill and its transitive deps.
 * Throws if cycles are found.
 */
export function resolveExecutionOrder(skills: SkillMeta[], targetName: string): string[] {
  const graph = buildDependencyGraph(skills);
  const cycles = detectCycles(graph);
  if (cycles.length > 0) {
    throw new Error(`Circular dependency detected: ${cycles[0].join(" → ")}`);
  }

  // Collect transitive deps via DFS
  const visited = new Set<string>();
  const order: string[] = [];

  function dfs(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of graph.get(name) ?? []) {
      dfs(dep);
    }
    order.push(name); // Post-order: deps before dependents
  }

  dfs(targetName);
  return order;
}

/**
 * Run a chain test (dry run) — validates that the dependency chain is resolvable
 * and each skill has the expected fields. No actual LLM calls.
 */
export function dryRunChain(
  skills: SkillMeta[],
  targetName: string,
): ChainResult {
  const start = Date.now();
  const steps: ChainStep[] = [];
  const skillByName = new Map(skills.map((s) => [s.name, s]));

  let executionOrder: string[];
  try {
    executionOrder = resolveExecutionOrder(skills, targetName);
  } catch (err: any) {
    return {
      steps: [{ skillName: targetName, status: "failed", error: err.message }],
      success: false,
      totalDurationMs: Date.now() - start,
    };
  }

  let chainBroken = false;
  for (const name of executionOrder) {
    if (chainBroken) {
      steps.push({ skillName: name, status: "skipped" });
      continue;
    }

    const skill = skillByName.get(name);
    if (!skill) {
      steps.push({ skillName: name, status: "failed", error: `Skill "${name}" not found` });
      chainBroken = true;
      continue;
    }

    // Validate required fields
    const issues: string[] = [];
    if (!skill.description) issues.push("missing description");
    if (skill.requires.length > 0 && !skill.outputFormat) {
      issues.push("has dependencies but no output_format");
    }

    if (issues.length > 0) {
      steps.push({
        skillName: name,
        status: "passed",
        output: `Warnings: ${issues.join(", ")}`,
        durationMs: 0,
      });
    } else {
      steps.push({ skillName: name, status: "passed", durationMs: 0 });
    }
  }

  return {
    steps,
    success: !chainBroken,
    totalDurationMs: Date.now() - start,
  };
}
