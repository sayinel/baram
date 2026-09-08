// §5.5 Mermaid Block — editing-mode header: label, type badge, template
// dropdown, Expand (moved out of mermaid-block-view.tsx §perf-large-file
// file-size split). Zero-hook: the parent owns all state, including the
// template dropdown's outside-click dismissal (resolves via wrapperRef, not
// ref identity, so it must stay above this component).

import React from "react";

import { Tooltip } from "../../../components/Tooltip";
import { useTranslation } from "../../../i18n/useTranslation";
import {
  MERMAID_TEMPLATES,
  mermaidTypeLabel,
} from "../../../utils/markdown/mermaid-utils";

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
  const { t } = useTranslation();
  return (
    <div className="mermaid-block-header">
      <span className="mermaid-block-label">mermaid</span>
      {detectedType && (
        <span className="mermaid-block-type-badge">
          {mermaidTypeLabel(t, detectedType)}
        </span>
      )}
      <div className="mermaid-block-actions">
        <div className="mermaid-template-wrapper">
          <Tooltip label={t("mermaidBlock.templates")} placement="bottom">
            <button
              className="mermaid-template-btn"
              onClick={() => setShowTemplates(!showTemplates)}
            >
              {t("mermaidBlock.template")} ▾
            </button>
          </Tooltip>
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
                  {t(tmpl.label)}
                </button>
              ))}
            </div>
          )}
        </div>
        <Tooltip label={t("blockChrome.editFullscreen")} placement="bottom">
          <button
            className="mermaid-fullscreen-btn"
            onClick={onOpenEditFullscreen}
          >
            {t("blockChrome.expandEditor")}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
