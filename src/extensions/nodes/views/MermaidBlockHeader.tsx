// §5.5 Mermaid Block — editing-mode header: label, type badge, template
// dropdown, Expand (moved out of mermaid-block-view.tsx §perf-large-file
// file-size split). Zero-hook: the parent owns all state, including the
// template dropdown's outside-click dismissal (resolves via wrapperRef, not
// ref identity, so it must stay above this component).

import React from "react";

import { MERMAID_TEMPLATES } from "../../../utils/markdown/mermaid-utils";

interface MermaidBlockHeaderProps {
  applyTemplate: (key: string) => void;
  detectedType: null | string;
  onOpenEditFullscreen: () => void;
  setShowTemplates: (value: boolean) => void;
  showTemplates: boolean;
}

export function MermaidBlockHeader({
  applyTemplate,
  detectedType,
  onOpenEditFullscreen,
  setShowTemplates,
  showTemplates,
}: MermaidBlockHeaderProps): React.ReactElement {
  return (
    <div className="mermaid-block-header">
      <span className="mermaid-block-label">mermaid</span>
      {detectedType && (
        <span className="mermaid-block-type-badge">
          {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
        </span>
      )}
      <div className="mermaid-block-actions">
        <div className="mermaid-template-wrapper">
          <button
            className="mermaid-template-btn"
            onClick={() => setShowTemplates(!showTemplates)}
            title="Diagram templates"
          >
            Template ▾
          </button>
          {showTemplates && (
            <div className="mermaid-template-dropdown">
              {Object.entries(MERMAID_TEMPLATES).map(([key, tmpl]) => (
                <button
                  className={[
                    "mermaid-template-dropdown-item",
                    detectedType === key && "mermaid-template-active",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={key}
                  onClick={() => applyTemplate(key)}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="mermaid-fullscreen-btn"
          onClick={onOpenEditFullscreen}
          title="Edit full-screen"
        >
          Expand
        </button>
      </div>
    </div>
  );
}
