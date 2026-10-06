import { useEffect, useMemo, useState } from "react";

import { CornerDownLeft, RotateCcw } from "lucide-react";
import { useShallow } from "zustand/shallow";

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
  keybindingLabel,
  pluginKeybindingEntries,
  pluginOverlap,
} from "../../../keybindings/plugin-keybindings";
import {
  conflictCommandId,
  findConflict,
  isRefusedConflict,
  type KeybindingConflict,
  type MergedKeybinding,
  useKeybindings,
} from "../../../keybindings/use-keybindings";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useSettingsStore } from "../../../stores/settings/store";
import { showConfirm } from "../../../utils/confirm-dialog";
import { SettingsSectionHeader } from "../settings-shared";
import { KeybindingConflictNote } from "./keybinding-conflict-note";

/** §391 spec 0070 §8 — the note each overlap kind draws on a plugin row. */
const OVERLAP_KEYS = {
  "both-run": "keybindings.overlap.bothRun",
  shadowed: "keybindings.overlap.shadowed",
} as const;

export function KeybindingsTab() {
  const { t } = useTranslation();
  const {
    keybindingOverrides,
    setKeybindingOverride,
    removeKeybindingOverride,
    resetAllKeybindings,
  } = useSettingsStore(
    useShallow((s) => ({
      keybindingOverrides: s.keybindingOverrides,
      setKeybindingOverride: s.setKeybindingOverride,
      removeKeybindingOverride: s.removeKeybindingOverride,
      resetAllKeybindings: s.resetAllKeybindings,
    })),
  );
  // §391 spec 0070 §8 — subscribed: a plugin coming or going redraws the list. The entries are
  // cached per slice object by `pluginKeybindingEntries`, so no memo here.
  const contributions = usePluginUIStore(useShallow((s) => s.contributions));
  const pluginEntries = pluginKeybindingEntries(contributions);
  const merged = useKeybindings();
  const [filter, setFilter] = useState("");
  const [capturingId, setCapturingId] = useState<null | string>(null);
  const [capturedKey, setCapturedKey] = useState<null | string>(null);
  const [conflict, setConflict] = useState<KeybindingConflict | null>(null);

  const isMac = navigator.platform.includes("Mac");

  const filtered = useMemo(() => {
    if (!filter) return merged;
    const q = filter.toLowerCase();
    return merged.filter(
      (e) =>
        keybindingLabel(e, t).toLowerCase().includes(q) ||
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
        pluginEntries,
      );
      setConflict(conflicting);
    };

    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [capturingId, keybindingOverrides, isMac, pluginEntries]);

  // D13 — the note shows, but a core command's key cannot be given to a plugin command.
  const refused =
    capturingId !== null && isRefusedConflict(capturingId, conflict);

  const confirmCapture = () => {
    if (!capturingId || !capturedKey || refused) return;
    // A swap: the counterpart's stored key goes — plugin ↔ plugin when the target is a plugin
    // command (`refused` stopped the rest), and as before when the target is a core command.
    if (conflict) {
      removeKeybindingOverride(conflictCommandId(conflict));
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
          {grouped.get(cat)!.map((entry) => {
            // §391 — a plugin row whose key another entry also has says which one runs.
            const overlap = pluginOverlap(entry, merged);
            return (
              <div
                className={`keybinding-row ${entry.isOverridden ? "keybinding-overridden" : ""} ${!entry.customizable ? "keybinding-readonly-row" : ""}`}
                key={entry.id}
              >
                <span className="keybinding-label">
                  {keybindingLabel(entry, t)}
                  {entry.pluginName !== undefined && (
                    <>
                      {" "}
                      <span className="keybinding-plugin-name">
                        {entry.pluginName}
                      </span>
                    </>
                  )}
                  {overlap && (
                    <span className="keybinding-overlap">
                      {t(OVERLAP_KEYS[overlap])}
                    </span>
                  )}
                </span>
                <span className="keybinding-key">
                  {capturingId === entry.id ? (
                    <span className="keybinding-capture">
                      {capturedKey ? (
                        <>
                          <span className="keybinding-capture-key">
                            {formatKeyForDisplay(capturedKey, isMac)}
                          </span>
                          {conflict && (
                            <KeybindingConflictNote
                              conflict={conflict}
                              refused={refused}
                              t={t}
                            />
                          )}
                          <button
                            aria-label={t("keybindings.capture.confirm")}
                            className="keybinding-confirm-btn"
                            disabled={refused}
                            onClick={confirmCapture}
                            title={t("keybindings.capture.confirm")}
                          >
                            <CornerDownLeft
                              className="icon-inline"
                              size="1em"
                            />
                          </button>
                        </>
                      ) : (
                        <span className="keybinding-capture-prompt">
                          {t("keybindings.capture.prompt")}
                        </span>
                      )}
                    </span>
                  ) : entry.activeKey === "" ? (
                    // §391 D3 — a plugin command starts with no key; the user gives it one.
                    <span className="keybinding-unassigned">
                      {t("keybindings.unassigned")}
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
                          <RotateCcw className="icon-inline" size="1em" />
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
            );
          })}
        </div>
      ))}

      {Object.keys(keybindingOverrides).length > 0 && (
        <div className="keybinding-reset-all">
          <button
            className="settings-btn"
            // issue 523: the app's own confirm dialog, not the webview's
            // native confirm() — one look for every destructive question.
            // The confirm button says what it does; the helper's default
            // "Delete" would be a lie here.
            onClick={async () => {
              // A pending key capture owns every keydown on window (capture
              // phase, preventDefault + stopPropagation) — it would swallow
              // the dialog's Enter and Escape. The user moved on; end it.
              setCapturingId(null);
              setCapturedKey(null);
              setConflict(null);
              const confirmed = await showConfirm(
                t("keybindings.resetAll.confirm"),
                {
                  cancelLabel: t("common.cancel"),
                  confirmLabel: t("keybindings.resetAll"),
                },
              );
              if (confirmed) resetAllKeybindings();
            }}
          >
            {t("keybindings.resetAll")}
          </button>
        </div>
      )}
    </div>
  );
}
