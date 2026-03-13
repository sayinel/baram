// §72c Skill Lint Section — live lint results in PropertiesPanel
import { useState } from "react";

import type { LintResult } from "../../utils/prompt-linter";

import { useSkillStore } from "../../stores/skill-store";
import { registerSkillSection } from "./skill-panel-registry";

// ─── LintItem ────────────────────────────────────────────────────────────────

export function SkillLintSection() {
  const lintResults = useSkillStore((s) => s.lintResults);
  const [expanded, setExpanded] = useState(false);

  if (lintResults.length === 0) return null;

  const errorCount = lintResults.filter((r) => r.severity === "error").length;
  const warningCount = lintResults.filter(
    (r) => r.severity === "warning",
  ).length;

  return (
    <div className="skill-lint-section">
      <button
        className="skill-lint-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="skill-section-arrow">
          {expanded ? "\u25be" : "\u25b8"}
        </span>
        <span>Lint</span>
        {errorCount > 0 && (
          <span className="skill-lint-badge skill-lint-badge--error">
            {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="skill-lint-badge skill-lint-badge--warning">
            {warningCount}
          </span>
        )}
      </button>

      {expanded && (
        <div className="skill-lint-items">
          {lintResults.map((result, i) => (
            <LintItem key={i} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SkillLintSection ────────────────────────────────────────────────────────

function LintItem({ result }: { result: LintResult }) {
  const handleClick = () => {
    window.dispatchEvent(
      new CustomEvent("baram:goto-position", { detail: { from: result.from } }),
    );
  };

  return (
    <div className="skill-lint-item" onClick={handleClick}>
      <span className="skill-lint-rule">{result.rule}</span>
      <span className="skill-lint-message">{result.message}</span>
    </div>
  );
}

// §72c Self-register into skill panel registry
registerSkillSection({
  id: "lint",
  title: "Lint",
  order: 10,
  component: SkillLintSection,
});
