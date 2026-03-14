// §72b Skill Dependency Section — dependency analysis UI for PropertiesPanel
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../stores/file-store";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSkillStore } from "../../stores/skill-store";
import {
  type ChainResult,
  dryRunChain,
} from "../../utils/skill/skill-chain-runner";
import {
  analyzeSkillDependencies,
  buildDependencyGraph,
  type DependencyWarning,
  getImpactAnalysis,
  getReverseDependencies,
  parseSkillFrontmatter,
  type SkillMeta,
} from "../../utils/skill/skill-dependency-analyzer";
import { isSkillFrontmatter } from "../../utils/skill/skill-frontmatter";
import { registerSkillSection } from "./skill-panel-registry";

export function SkillDependencySection() {
  const fileTree = useFileStore((s) => s.fileTree);
  const { activeTabId, tabs } = useEditorStore();
  const isSkill = useSkillStore((s) => s.isSkill);

  // Derive yaml and filePath from stores
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? "";
  const openFiles = useFileStore((s) => s.openFiles);
  const content = filePath ? (openFiles.get(filePath) ?? "") : "";
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const yaml = fmMatch ? fmMatch[1] : "";

  const [allSkills, setAllSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showImpact, setShowImpact] = useState(false);
  const [chainResult, setChainResult] = useState<ChainResult | null>(null);

  const currentSkill = useMemo(
    () => parseSkillFrontmatter(yaml, filePath),
    [yaml, filePath],
  );

  // Scan workspace for all skill files
  const scanSkills = useCallback(async () => {
    setLoading(true);
    try {
      const mdFiles = collectMdFiles(fileTree);
      const { openFiles } = useFileStore.getState();
      const skills: SkillMeta[] = [];

      for (const file of mdFiles) {
        let content = openFiles.get(file.path);
        if (!content) {
          try {
            content = await readFile(file.path);
          } catch {
            continue;
          }
        }

        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fmMatch) continue;
        const fmYaml = fmMatch[1];
        if (!isSkillFrontmatter(fmYaml)) continue;

        skills.push(parseSkillFrontmatter(fmYaml, file.path));
      }

      setAllSkills(skills);
    } finally {
      setLoading(false);
    }
  }, [fileTree]);

  // Scan on mount and when fileTree changes
  useEffect(() => {
    scanSkills();
  }, [scanSkills]);

  const graph = useMemo(() => buildDependencyGraph(allSkills), [allSkills]);

  const warnings = useMemo(
    () =>
      analyzeSkillDependencies(
        allSkills,
        new Set(allSkills.map((s) => s.name)),
      ),
    [allSkills],
  );

  const currentWarnings = useMemo(
    () => warnings.filter((w) => w.skillName === currentSkill.name),
    [warnings, currentSkill.name],
  );

  const reverseDeps = useMemo(
    () => getReverseDependencies(allSkills, currentSkill.name),
    [allSkills, currentSkill.name],
  );

  const impact = useMemo(
    () => getImpactAnalysis(allSkills, currentSkill.name),
    [allSkills, currentSkill.name],
  );

  // Early return if not a skill file (AFTER all hooks to satisfy Rules of Hooks)
  if (!isSkill || !filePath) return null;

  const hasNoDeps =
    currentSkill.requires.length === 0 && reverseDeps.length === 0;

  return (
    <div className="dep-section">
      <button
        className="dep-section-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="skill-section-arrow">
          {expanded ? "\u25be" : "\u25b8"}
        </span>
        <span>Dependencies</span>
        {currentWarnings.length > 0 && (
          <span className="dep-badge dep-badge--error">
            {currentWarnings.length}
          </span>
        )}
        {loading && <span className="dep-loading" />}
      </button>

      {expanded && (
        <div className="dep-section-body">
          {/* Warnings */}
          {currentWarnings.length > 0 && (
            <div className="dep-warnings">
              {currentWarnings.map((w, i) => (
                <WarningItem key={i} warning={w} />
              ))}
            </div>
          )}

          {/* Mini Graph */}
          {!hasNoDeps && (
            <DependencyGraph
              allSkills={allSkills}
              currentName={currentSkill.name}
              graph={graph}
            />
          )}

          {/* Requires list */}
          {currentSkill.requires.length > 0 && (
            <div className="dep-list">
              <div className="dep-list-title">
                Requires ({currentSkill.requires.length})
              </div>
              {currentSkill.requires.map((req) => {
                const found = allSkills.find((s) => s.name === req);
                return (
                  <div
                    className={`dep-list-item${found ? "" : "dep-list-item--missing"}`}
                    key={req}
                  >
                    <span className="dep-list-icon">
                      {found ? "\u2192" : "\u2717"}
                    </span>
                    <span>{req}</span>
                    {!found && <span className="dep-list-hint">not found</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Reverse dependencies (P2 §72b Task 5) */}
          {reverseDeps.length > 0 && (
            <div className="dep-list">
              <div className="dep-list-title">
                Used by ({reverseDeps.length})
              </div>
              {reverseDeps.map((name) => (
                <div className="dep-list-item" key={name}>
                  <span className="dep-list-icon">{"\u2190"}</span>
                  <span>{name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Impact analysis (P2 §72b Task 5) */}
          {impact.length > 0 && (
            <div className="dep-list">
              <button
                className="dep-impact-toggle"
                onClick={() => setShowImpact((v) => !v)}
              >
                Impact Analysis ({impact.length} affected)
                <span>{showImpact ? "\u25be" : "\u25b8"}</span>
              </button>
              {showImpact &&
                impact.map((name) => (
                  <div
                    className="dep-list-item dep-list-item--impact"
                    key={name}
                  >
                    <span className="dep-list-icon">{"\u26a1"}</span>
                    <span>{name}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Chain Test (P2 §72b Task 6) */}
          {currentSkill.requires.length > 0 && (
            <div className="dep-chain">
              <button
                className="dep-chain-btn"
                disabled={loading || allSkills.length === 0}
                onClick={() =>
                  setChainResult(dryRunChain(allSkills, currentSkill.name))
                }
              >
                Chain Test (dry run)
              </button>
              {chainResult && (
                <div
                  className={`dep-chain-result dep-chain-result--${chainResult.success ? "ok" : "fail"}`}
                >
                  <div className="dep-chain-status">
                    {chainResult.success ? "Chain OK" : "Chain broken"} (
                    {chainResult.totalDurationMs}ms)
                  </div>
                  {chainResult.steps.map((step, i) => (
                    <div
                      className={`dep-chain-step dep-chain-step--${step.status}`}
                      key={i}
                    >
                      <span className="dep-chain-step-icon">
                        {step.status === "passed"
                          ? "\u2713"
                          : step.status === "failed"
                            ? "\u2717"
                            : step.status === "skipped"
                              ? "\u2013"
                              : "\u2026"}
                      </span>
                      <span>{step.skillName}</span>
                      {step.error && (
                        <span className="dep-chain-step-err">{step.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {hasNoDeps && !loading && (
            <div className="dep-empty">No dependencies</div>
          )}

          <button
            className="dep-rescan"
            disabled={loading}
            onClick={scanSkills}
          >
            {loading ? "Scanning..." : "\u21bb Rescan"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── WarningItem ──────────────────────────────────────────────────────────────

/** Recursively collect all .md files from the file tree */
function collectMdFiles(tree: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of tree) {
    if (!entry.isDir && entry.name.endsWith(".md")) {
      result.push(entry);
    }
    if (entry.isDir && entry.children) {
      result.push(...collectMdFiles(entry.children));
    }
  }
  return result;
}

// ─── DependencyGraph (Cytoscape mini-graph) ───────────────────────────────────

function DependencyGraph({
  currentName,
  allSkills,
  graph,
}: {
  allSkills: SkillMeta[];
  currentName: string;
  graph: Map<string, string[]>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<null | { destroy(): void }>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Collect visible nodes: current + direct deps + reverse deps
    const nodes = new Set<string>();
    nodes.add(currentName);
    const currentDeps = graph.get(currentName) ?? [];
    for (const dep of currentDeps) nodes.add(dep);
    const reverseDeps = getReverseDependencies(allSkills, currentName);
    for (const rd of reverseDeps) nodes.add(rd);

    if (nodes.size <= 1 && currentDeps.length === 0) {
      return; // Nothing to graph
    }

    // Resolve CSS variables for Cytoscape (doesn't support var())
    const computed = getComputedStyle(document.documentElement);
    const accent =
      computed.getPropertyValue("--color-accent").trim() || "#6366f1";
    const borderColor =
      computed.getPropertyValue("--color-border").trim() || "#d1d5db";
    const textColor =
      computed.getPropertyValue("--color-text").trim() || "#1f2937";
    const bgSecondary =
      computed.getPropertyValue("--color-bg-secondary").trim() || "#f3f4f6";

    let cancelled = false;

    import("cytoscape").then(({ default: cytoscape }) => {
      if (cancelled || !containerRef.current) return;
      if (cyRef.current) cyRef.current.destroy();

      const cyNodes = [...nodes].map((name) => ({
        data: { id: name, label: name },
        classes: name === currentName ? "current" : undefined,
      }));

      const cyEdges: { data: { source: string; target: string } }[] = [];
      for (const name of nodes) {
        for (const dep of graph.get(name) ?? []) {
          if (nodes.has(dep)) {
            cyEdges.push({ data: { source: name, target: dep } });
          }
        }
      }

      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: [...cyNodes, ...cyEdges],
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "font-size": "9px",
              width: 22,
              height: 22,
              "background-color": bgSecondary,
              "border-width": 1,
              "border-color": borderColor,
              color: textColor,
              "text-valign": "bottom",
              "text-margin-y": 4,
            } as Record<string, unknown>,
          },
          {
            selector: "node.current",
            style: {
              "background-color": accent,
              "border-width": 2,
              "border-color": accent,
              color: accent,
              "font-weight": "bold",
            } as Record<string, unknown>,
          },
          {
            selector: "edge",
            style: {
              width: 1.5,
              "line-color": borderColor,
              "target-arrow-color": borderColor,
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              "arrow-scale": 0.8,
            } as Record<string, unknown>,
          },
        ],
        layout: { name: "breadthfirst", directed: true, padding: 10 },
        userZoomingEnabled: false,
        userPanningEnabled: false,
        autoungrabify: true,
      });
    });

    return () => {
      cancelled = true;
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [currentName, allSkills, graph]);

  return <div className="dep-graph-container" ref={containerRef} />;
}

// ─── SkillDependencySection ───────────────────────────────────────────────────

function WarningItem({ warning }: { warning: DependencyWarning }) {
  const isError = warning.severity === "error";
  return (
    <div className={`dep-warning dep-warning--${warning.severity}`}>
      <span className="dep-warning-icon">{isError ? "\u2717" : "!"}</span>
      <span className="dep-warning-msg">{warning.message}</span>
    </div>
  );
}

// §72c Self-register into skill panel registry
registerSkillSection({
  id: "dependencies",
  title: "Dependencies",
  order: 50,
  component: SkillDependencySection,
});
