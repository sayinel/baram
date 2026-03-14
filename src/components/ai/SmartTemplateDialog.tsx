// §11.8 Smart Template Dialog — template selection grid for document generation
import { useCallback, useState } from "react";

import { getBuiltinTemplates } from "../../utils/smart-templates";

interface SmartTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate?: (id: string) => void;
}

export function SmartTemplateDialog({
  isOpen,
  onClose,
  onGenerate,
}: SmartTemplateDialogProps) {
  const [customDescription, setCustomDescription] = useState("");
  const templates = getBuiltinTemplates();

  const handleSelect = useCallback(
    (id: string) => {
      onGenerate?.(id);
    },
    [onGenerate],
  );

  const handleCustomGenerate = useCallback(() => {
    if (!customDescription.trim()) return;
    onGenerate?.(`custom:${customDescription.trim()}`);
  }, [customDescription, onGenerate]);

  if (!isOpen) return null;

  return (
    <div className="smart-template-overlay" onClick={onClose}>
      <div
        className="smart-template-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="smart-template-header">
          <h2 className="smart-template-title">Smart Templates</h2>
          <button
            className="smart-template-close"
            onClick={onClose}
            type="button"
          >
            &times;
          </button>
        </div>

        <div className="smart-template-grid">
          {templates.map((tmpl) => (
            <button
              className="smart-template-card"
              key={tmpl.id}
              onClick={() => handleSelect(tmpl.id)}
              type="button"
            >
              <span className="smart-template-card-name">{tmpl.name}</span>
              <span className="smart-template-card-sections">
                {tmpl.sections.length} sections
              </span>
            </button>
          ))}
        </div>

        <div className="smart-template-custom">
          <span className="smart-template-custom-label">Custom...</span>
          <div className="smart-template-custom-row">
            <input
              className="smart-template-custom-input"
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Describe your template..."
              type="text"
              value={customDescription}
            />
            <button
              className="smart-template-custom-btn"
              disabled={!customDescription.trim()}
              onClick={handleCustomGenerate}
              type="button"
            >
              Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
