// §3.6 3-way merge resolution UI — full-screen overlay that doubles as a diff
// view. Unchanged lines are context; one-sided edits (local/external) are shown
// as +/- diffs and auto-applied; conflicts offer local / external / both.
import { useState } from "react";

import type { MergeSegment } from "../../ipc/types";

type Choice = "both" | "external" | "local";

interface MergeViewProps {
  filePath: string;
  onApply: (merged: string) => void;
  onCancel: () => void;
  segments: MergeSegment[];
}

export function MergeView({
  filePath,
  onApply,
  onCancel,
  segments,
}: MergeViewProps) {
  const [choices, setChoices] = useState<Record<number, Choice>>({});

  const conflictIndices = segments
    .map((s, i) => (s.kind === "conflict" ? i : -1))
    .filter((i) => i >= 0);
  const allResolved = conflictIndices.every((i) => choices[i] !== undefined);

  const buildMerged = (): string => {
    const lines: string[] = [];
    segments.forEach((seg, i) => {
      switch (seg.kind) {
        case "conflict": {
          const choice = choices[i];
          if (choice === "local") lines.push(...seg.local);
          else if (choice === "external") lines.push(...seg.external);
          else if (choice === "both") lines.push(...seg.local, ...seg.external);
          break;
        }
        case "external":
          lines.push(...seg.external);
          break;
        case "local":
          lines.push(...seg.local);
          break;
        case "unchanged":
          lines.push(...seg.lines);
          break;
      }
    });
    return lines.join("\n");
  };

  return (
    <div aria-modal="true" className="merge-overlay" role="dialog">
      <div className="merge-panel">
        <header className="merge-header">
          <span className="merge-title">Merge — {filePath}</span>
          <div className="merge-header-actions">
            <button
              className="merge-btn merge-btn-apply"
              disabled={!allResolved}
              onClick={() => onApply(buildMerged())}
            >
              Apply Merge
            </button>
            <button className="merge-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </header>
        <div className="merge-body">
          {segments.map((seg, i) => {
            switch (seg.kind) {
              case "conflict": {
                const choice = choices[i];
                const localSel = choice === "both" || choice === "local";
                const externalSel = choice === "both" || choice === "external";
                return (
                  <div className="merge-conflict" key={i}>
                    <div className="merge-choice-row">
                      {(["local", "external", "both"] as Choice[]).map((c) => (
                        <button
                          className={cx(
                            "merge-choice",
                            choice === c && "merge-choice-active",
                          )}
                          key={c}
                          onClick={() =>
                            setChoices((prev) => ({ ...prev, [i]: c }))
                          }
                        >
                          {c === "local"
                            ? "내 것"
                            : c === "external"
                              ? "외부"
                              : "둘 다"}
                        </button>
                      ))}
                    </div>
                    <div className="merge-candidates">
                      <pre
                        className={cx(
                          "merge-candidate merge-candidate-local",
                          localSel && "merge-candidate-selected",
                        )}
                      >
                        {seg.local.join("\n")}
                      </pre>
                      <pre
                        className={cx(
                          "merge-candidate merge-candidate-external",
                          externalSel && "merge-candidate-selected",
                        )}
                      >
                        {seg.external.join("\n")}
                      </pre>
                    </div>
                  </div>
                );
              }
              case "external":
                return (
                  <DiffBlock
                    base={seg.base}
                    key={i}
                    next={seg.external}
                    tone="external"
                  />
                );
              case "local":
                return (
                  <DiffBlock
                    base={seg.base}
                    key={i}
                    next={seg.local}
                    tone="local"
                  />
                );
              case "unchanged":
                if (seg.lines.length === 0) return null;
                return (
                  <pre className="merge-stable" key={i}>
                    {seg.lines.join("\n")}
                  </pre>
                );
            }
          })}
        </div>
      </div>
    </div>
  );
}

function cx(...parts: (false | string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** A one-sided edit rendered as a +/- diff (base removed, new added). */
function DiffBlock({
  base,
  next,
  tone,
}: {
  base: string[];
  next: string[];
  tone: "external" | "local";
}) {
  return (
    <div className={`merge-change merge-change-${tone}`}>
      {base.map((line, j) => (
        <div className="merge-line merge-line-del" key={`b${j}`}>
          <span className="merge-line-prefix">-</span>
          <span className="merge-line-content">{line}</span>
        </div>
      ))}
      {next.map((line, j) => (
        <div className="merge-line merge-line-add" key={`n${j}`}>
          <span className="merge-line-prefix">+</span>
          <span className="merge-line-content">{line}</span>
        </div>
      ))}
    </div>
  );
}
