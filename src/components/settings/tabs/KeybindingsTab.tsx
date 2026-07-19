import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  formatKeyForDisplay,
  normalizeKeyEvent,
} from "../../../keybindings/key-utils";
import {
  CATEGORY_LABELS,
  KEYBINDING_CATEGORIES,
} from "../../../keybindings/keybinding-registry";
import {
  findConflict,
  getMergedKeybindings,
  type MergedKeybinding,
} from "../../../keybindings/use-keybindings";
import { useSettingsStore } from "../../../stores/settings/store";
import { SettingsSectionHeader } from "../settings-shared";

export function KeybindingsTab() {
  const { t } = useTranslation();
  const {
    keybindingOverrides,
    setKeybindingOverride,
    removeKeybindingOverride,
    resetAllKeybindings,
  } = useSettingsStore();
  const merged = getMergedKeybindings(keybindingOverrides);
  const [filter, setFilter] = useState("");
  const [capturingId, setCapturingId] = useState<null | string>(null);
  const [capturedKey, setCapturedKey] = useState<null | string>(null);
  const [conflict, setConflict] = useState<MergedKeybinding | null>(null);

  const isMac = navigator.platform.includes("Mac");

  const filtered = useMemo(() => {
    if (!filter) return merged;
    const q = filter.toLowerCase();
    return merged.filter(
      (e) =>
        t(e.label).toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        formatKeyForDisplay(e.activeKey, isMac).toLowerCase().includes(q),
    );
  }, [merged, filter, t, isMac]);

  const grouped = useMemo(() => {
    const map = new Map<string, MergedKeybinding[]>();
    for (const entry of filtered) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [filtered]);

  // Key capture handler
  useEffect(() => {
    if (!capturingId) return;

    const handleCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCapturingId(null);
        setCapturedKey(null);
        setConflict(null);
        return;
      }

      if (["Alt", "Control", "Meta", "Shift"].includes(e.key)) return;

      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;

      setCapturedKey(normalized);
      const conflicting = findConflict(
        capturingId,
        normalized,
        keybindingOverrides,
      );
      setConflict(conflicting);
    };

    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [capturingId, keybindingOverrides, isMac]);

  const confirmCapture = () => {
    if (!capturingId || !capturedKey) return;
    if (conflict) {
      removeKeybindingOverride(conflict.id);
    }
    setKeybindingOverride(capturingId, capturedKey);
    setCapturingId(null);
    setCapturedKey(null);
    setConflict(null);
  };

  const startCapture = (id: string) => {
    setCapturingId(id);
    setCapturedKey(null);
    setConflict(null);
  };

  return (
    <div className="settings-section">
      <div className="keybindings-filter">
        <input
          className="settings-search-input"
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("keybindings.search.placeholder")}
          type="text"
          value={filter}
        />
      </div>

      {filtered.length === 0 && filter && (
        <div className="settings-empty">
          {t("keybindings.search.empty").replace("{query}", filter)}
        </div>
      )}

      {KEYBINDING_CATEGORIES.filter((cat) => grouped.has(cat)).map((cat) => (
        <div key={cat}>
          <SettingsSectionHeader title={t(CATEGORY_LABELS[cat])} />
          {grouped.get(cat)!.map((entry) => (
            <div
              className={`keybinding-row ${entry.isOverridden ? "keybinding-overridden" : ""} ${!entry.customizable ? "keybinding-readonly-row" : ""}`}
              key={entry.id}
            >
              <span className="keybinding-label">{t(entry.label)}</span>
              <span className="keybinding-key">
                {capturingId === entry.id ? (
                  <span className="keybinding-capture">
                    {capturedKey ? (
                      <>
                        <span className="keybinding-capture-key">
                          {formatKeyForDisplay(capturedKey, isMac)}
                        </span>
                        {conflict && (
                          <span className="keybinding-conflict">
                            {t("keybindings.conflict").replace(
                              "{command}",
                              t(conflict.label),
                            )}
                          </span>
                        )}
                        <button
                          className="keybinding-confirm-btn"
                          onClick={confirmCapture}
                        >
                          {"\u21A9"}
                        </button>
                      </>
                    ) : (
                      <span className="keybinding-capture-prompt">
                        {t("keybindings.capture.prompt")}
                      </span>
                    )}
                  </span>
                ) : (
                  <kbd className="keybinding-kbd">
                    {formatKeyForDisplay(entry.activeKey, isMac)}
                  </kbd>
                )}
              </span>
              <span className="keybinding-actions">
                {entry.customizable ? (
                  <>
                    {entry.isOverridden && (
                      <button
                        className="keybinding-reset-btn"
                        onClick={() => removeKeybindingOverride(entry.id)}
                        title={t("keybindings.reset")}
                      >
                        {"\u21BA"}
                      </button>
                    )}
                    <button
                      className="keybinding-edit-btn"
                      onClick={() => startCapture(entry.id)}
                    >
                      {t("keybindings.edit")}
                    </button>
                  </>
                ) : (
                  <span className="keybinding-readonly-badge" />
                )}
              </span>
            </div>
          ))}
        </div>
      ))}

      {Object.keys(keybindingOverrides).length > 0 && (
        <div className="keybinding-reset-all">
          <button
            className="settings-btn"
            onClick={() => {
              if (confirm(t("keybindings.resetAll.confirm"))) {
                resetAllKeybindings();
              }
            }}
          >
            {t("keybindings.resetAll")}
          </button>
        </div>
      )}
    </div>
  );
}
