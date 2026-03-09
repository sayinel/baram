// §72b Skill Dependency Analyzer — static analysis of requires chains

export interface SkillMeta {
  name: string;
  filePath: string;
  requires: string[];
  outputFormat: string;
  description?: string;
  version?: string;
}

export interface DependencyWarning {
  type: "missing-file" | "circular" | "missing-field" | "format-mismatch";
  message: string;
  severity: "error" | "warning";
  skillName: string;
  relatedSkill?: string;
}

/** Parse YAML frontmatter into SkillMeta */
export function parseSkillFrontmatter(
  yaml: string,
  filePath: string,
): SkillMeta {
  const getName = (y: string) => {
    const m = y.match(/^name\s*:\s*(.+)$/m);
    return m
      ? m[1].trim()
      : (filePath.split("/").pop()?.replace(/\.md$/, "") ?? "");
  };

  const getRequires = (y: string): string[] => {
    const m = y.match(/^requires\s*:\s*\[([^\]]*)\]$/m);
    if (!m) return [];
    const inner = m[1].trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const getField = (y: string, field: string): string => {
    const m = y.match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : "";
  };

  return {
    name: getName(yaml),
    filePath,
    requires: getRequires(yaml),
    outputFormat: getField(yaml, "output_format"),
    description: getField(yaml, "description") || undefined,
    version: getField(yaml, "version") || undefined,
  };
}

/** Build adjacency list from skill metas */
export function buildDependencyGraph(
  skills: SkillMeta[],
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const skill of skills) {
    graph.set(skill.name, [...skill.requires]);
  }
  return graph;
}

/** Detect circular dependencies using DFS. Returns array of cycle paths. */
export function detectCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    if (inStack.has(node)) {
      // Found cycle — extract it
      const cycleStart = path.indexOf(node);
      cycles.push([...path.slice(cycleStart), node]);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of graph.get(node) ?? []) {
      dfs(dep);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  return cycles;
}

/** Find skills that directly require the target skill */
export function getReverseDependencies(
  skills: SkillMeta[],
  targetName: string,
): string[] {
  return skills
    .filter((s) => s.requires.includes(targetName))
    .map((s) => s.name);
}

/** Transitive impact analysis — all skills affected if target changes */
export function getImpactAnalysis(
  skills: SkillMeta[],
  targetName: string,
): string[] {
  const impacted = new Set<string>();
  const queue = [targetName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = getReverseDependencies(skills, current);
    for (const dep of dependents) {
      if (!impacted.has(dep)) {
        impacted.add(dep);
        queue.push(dep);
      }
    }
  }

  return Array.from(impacted);
}

/** Run full static analysis on a set of skills */
export function analyzeSkillDependencies(
  skills: SkillMeta[],
  _existingFiles: Set<string>,
): DependencyWarning[] {
  const warnings: DependencyWarning[] = [];
  const skillNames = new Set(skills.map((s) => s.name));
  const skillByName = new Map(skills.map((s) => [s.name, s]));

  // Check each skill's requires
  for (const skill of skills) {
    for (const req of skill.requires) {
      // Missing file check
      if (!skillNames.has(req)) {
        warnings.push({
          type: "missing-file",
          message: `Required skill "${req}" not found`,
          severity: "error",
          skillName: skill.name,
          relatedSkill: req,
        });
      }

      // Format mismatch check
      const depSkill = skillByName.get(req);
      if (depSkill && depSkill.outputFormat && skill.outputFormat) {
        if (depSkill.outputFormat !== skill.outputFormat) {
          warnings.push({
            type: "format-mismatch",
            message: `"${req}" outputs "${depSkill.outputFormat}" but "${skill.name}" expects "${skill.outputFormat}"`,
            severity: "warning",
            skillName: skill.name,
            relatedSkill: req,
          });
        }
      }
    }

    // Missing output_format for skills that are required by others
    const isRequired = skills.some((s) => s.requires.includes(skill.name));
    if (isRequired && !skill.outputFormat) {
      warnings.push({
        type: "missing-field",
        message: `"${skill.name}" is used by other skills but has no output_format defined`,
        severity: "warning",
        skillName: skill.name,
      });
    }
  }

  // Circular dependency check
  const graph = buildDependencyGraph(skills);
  const cycles = detectCycles(graph);
  for (const cycle of cycles) {
    warnings.push({
      type: "circular",
      message: `Circular dependency: ${cycle.join(" → ")}`,
      severity: "error",
      skillName: cycle[0],
    });
  }

  return warnings;
}
