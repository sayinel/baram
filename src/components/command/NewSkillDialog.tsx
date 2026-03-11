// §42 New Skill Dialog — template selection for creating new Skills files
import { useState } from "react";

import type { SkillTemplate } from "../../utils/skill-templates";

import { SKILL_TEMPLATES } from "../../utils/skill-templates";

interface NewSkillDialogProps {
  onClose: () => void;
  onSelect: (template: SkillTemplate, name: string) => Promise<void> | void;
  open: boolean;
}

export function NewSkillDialog({
  open,
  onClose,
  onSelect,
}: NewSkillDialogProps) {
  const [selected, setSelected] = useState<string>("prompt");
  const [name, setName] = useState("");

  if (!open) return null;

  const template = SKILL_TEMPLATES.find((t) => t.id === selected);

  return (
    <div className="new-skill-overlay" onClick={onClose}>
      <div className="new-skill-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="new-skill-title">New Skill</h3>
        <div className="new-skill-name-row">
          <label className="new-skill-label">Name</label>
          <input
            autoFocus
            className="new-skill-input"
            onChange={(e) => setName(e.target.value)}
            placeholder="my-skill"
            type="text"
            value={name}
          />
        </div>
        <div className="new-skill-templates">
          {SKILL_TEMPLATES.map((t) => (
            <button
              className={`new-skill-template ${selected === t.id ? "new-skill-template-active" : ""}`}
              key={t.id}
              onClick={() => setSelected(t.id)}
            >
              <div className="new-skill-template-name">{t.name}</div>
              <div className="new-skill-template-desc">{t.description}</div>
            </button>
          ))}
        </div>
        <div className="new-skill-actions">
          <button className="new-skill-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="new-skill-create"
            disabled={!name.trim() || !template}
            onClick={async () => {
              if (template && name.trim()) {
                await onSelect(template, name.trim());
              }
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
