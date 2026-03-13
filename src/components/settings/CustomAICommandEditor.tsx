// §48 Custom AI Command Editor — manage custom commands in Settings
import { useCallback, useState } from "react";

import type { CustomAICommand } from "../../stores/ai-store";

import { useTranslation } from "../../i18n/useTranslation";
import { useAIStore } from "../../stores/ai-store";
import { generateCommandId } from "../../utils/custom-ai-commands";

export function CustomAICommandEditor() {
  const { t } = useTranslation();
  const {
    customCommands,
    addCustomCommand,
    removeCustomCommand,
    updateCustomCommand,
  } = useAIStore();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<null | string>(null);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  const handleAdd = useCallback(() => {
    if (!newName.trim() || !newPrompt.trim()) return;
    addCustomCommand({
      id: generateCommandId(),
      name: newName.trim(),
      prompt: newPrompt.trim(),
    });
    setNewName("");
    setNewPrompt("");
    setIsAdding(false);
  }, [newName, newPrompt, addCustomCommand]);

  const handleUpdate = useCallback(
    (id: string, name: string, prompt: string) => {
      updateCustomCommand(id, { name, prompt });
      setEditingId(null);
    },
    [updateCustomCommand],
  );

  const handleDelete = useCallback(
    (id: string) => {
      removeCustomCommand(id);
      if (editingId === id) setEditingId(null);
    },
    [removeCustomCommand, editingId],
  );

  return (
    <div className="custom-ai-commands">
      {customCommands.length === 0 && !isAdding && (
        <div className="custom-ai-empty">
          {t("settings.ai.customCommands.empty")}
        </div>
      )}

      {customCommands.map((cmd) => (
        <CustomCommandRow
          command={cmd}
          isEditing={editingId === cmd.id}
          key={cmd.id}
          onCancel={() => setEditingId(null)}
          onDelete={() => handleDelete(cmd.id)}
          onEdit={() => setEditingId(cmd.id)}
          onSave={(name, prompt) => handleUpdate(cmd.id, name, prompt)}
        />
      ))}

      {isAdding ? (
        <div className="custom-ai-form">
          <input
            autoFocus
            className="settings-input"
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("settings.ai.customCommands.namePlaceholder")}
            type="text"
            value={newName}
          />
          <textarea
            className="custom-ai-prompt-input"
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder={t("settings.ai.customCommands.promptPlaceholder")}
            rows={4}
            value={newPrompt}
          />
          <div className="custom-ai-form-actions">
            <button
              className="custom-ai-btn custom-ai-btn-primary"
              disabled={!newName.trim() || !newPrompt.trim()}
              onClick={handleAdd}
            >
              {t("settings.ai.customCommands.add")}
            </button>
            <button
              className="custom-ai-btn"
              onClick={() => {
                setIsAdding(false);
                setNewName("");
                setNewPrompt("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="custom-ai-btn custom-ai-btn-add"
          onClick={() => setIsAdding(true)}
        >
          {t("settings.ai.customCommands.addNew")}
        </button>
      )}
    </div>
  );
}

function CustomCommandRow({
  command,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: {
  command: CustomAICommand;
  isEditing: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSave: (name: string, prompt: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(command.name);
  const [prompt, setPrompt] = useState(command.prompt);

  if (isEditing) {
    return (
      <div className="custom-ai-form">
        <input
          autoFocus
          className="settings-input"
          onChange={(e) => setName(e.target.value)}
          type="text"
          value={name}
        />
        <textarea
          className="custom-ai-prompt-input"
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          value={prompt}
        />
        <div className="custom-ai-form-actions">
          <button
            className="custom-ai-btn custom-ai-btn-primary"
            disabled={!name.trim() || !prompt.trim()}
            onClick={() => onSave(name, prompt)}
          >
            {t("common.save")}
          </button>
          <button className="custom-ai-btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="custom-ai-row">
      <div className="custom-ai-row-info">
        <span className="custom-ai-row-name">{command.name}</span>
        <span className="custom-ai-row-preview">
          {command.prompt.length > 80
            ? command.prompt.slice(0, 80) + "..."
            : command.prompt}
        </span>
      </div>
      <div className="custom-ai-row-actions">
        <button
          className="custom-ai-btn-icon"
          onClick={onEdit}
          title={t("settings.ai.customCommands.edit")}
        >
          {t("settings.ai.customCommands.edit")}
        </button>
        <button
          className="custom-ai-btn-icon custom-ai-btn-danger"
          onClick={onDelete}
          title={t("common.delete")}
        >
          {t("settings.ai.customCommands.del")}
        </button>
      </div>
    </div>
  );
}
