// §48 Custom AI Command Editor — manage custom commands in Settings
import { useState, useCallback } from "react";
import { useAIStore } from "../../stores/ai-store";
import { generateCommandId } from "../../utils/custom-ai-commands";
import type { CustomAICommand } from "../../stores/ai-store";
import { useTranslation } from "../../i18n/useTranslation";

export function CustomAICommandEditor() {
  const { t } = useTranslation();
  const { customCommands, addCustomCommand, removeCustomCommand, updateCustomCommand } =
    useAIStore();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
          key={cmd.id}
          command={cmd}
          isEditing={editingId === cmd.id}
          onEdit={() => setEditingId(cmd.id)}
          onSave={(name, prompt) => handleUpdate(cmd.id, name, prompt)}
          onCancel={() => setEditingId(null)}
          onDelete={() => handleDelete(cmd.id)}
        />
      ))}

      {isAdding ? (
        <div className="custom-ai-form">
          <input
            type="text"
            className="settings-input"
            placeholder={t("settings.ai.customCommands.namePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <textarea
            className="custom-ai-prompt-input"
            placeholder={t("settings.ai.customCommands.promptPlaceholder")}
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            rows={4}
          />
          <div className="custom-ai-form-actions">
            <button
              className="custom-ai-btn custom-ai-btn-primary"
              onClick={handleAdd}
              disabled={!newName.trim() || !newPrompt.trim()}
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
  onEdit: () => void;
  onSave: (name: string, prompt: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(command.name);
  const [prompt, setPrompt] = useState(command.prompt);

  if (isEditing) {
    return (
      <div className="custom-ai-form">
        <input
          type="text"
          className="settings-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <textarea
          className="custom-ai-prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
        />
        <div className="custom-ai-form-actions">
          <button
            className="custom-ai-btn custom-ai-btn-primary"
            onClick={() => onSave(name, prompt)}
            disabled={!name.trim() || !prompt.trim()}
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
        <button className="custom-ai-btn-icon" onClick={onEdit} title={t("settings.ai.customCommands.edit")}>
          {t("settings.ai.customCommands.edit")}
        </button>
        <button className="custom-ai-btn-icon custom-ai-btn-danger" onClick={onDelete} title={t("common.delete")}>
          {t("settings.ai.customCommands.del")}
        </button>
      </div>
    </div>
  );
}
