// §72c Skill Lint Section — live lint results in PropertiesPanel
import { useState } from "react";

import type { LintResult } from "../../utils/prompt-linter";

import { ChevronDown, ChevronRight } from "lucide-react";

import { useTranslation } from "../../i18n/useTranslation";
import { useSkillStore } from "../../stores/ai/skill";
import { registerSkillSection } from "./skill-panel-registry";

// ─── LintItem ────────────────────────────────────────────────────────────────

export function SkillLintSection() {
  const { t } = useTranslation();
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
        aria-expanded={expanded}
        className="skill-lint-header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="skill-section-arrow">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span>{t("skills.lint.title")}</span>
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
