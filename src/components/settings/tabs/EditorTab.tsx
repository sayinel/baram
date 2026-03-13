import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings-store";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";

// ─── Font Family Picker ─────────────────────────────────

const FONT_OPTIONS = [
  { value: "system-ui", label: "System Default" },
  { value: "Pretendard", label: "Pretendard" },
  { value: "Inter", label: "Inter" },
  { value: "Noto Sans", label: "Noto Sans" },
  { value: "Noto Sans KR", label: "Noto Sans KR" },
  { value: "IBM Plex Sans", label: "IBM Plex Sans" },
  { value: "Roboto", label: "Roboto" },
  { value: "Lato", label: "Lato" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Source Sans 3", label: "Source Sans 3" },
  { value: "Merriweather", label: "Merriweather" },
  { value: "Georgia", label: "Georgia" },
  { value: "Lora", label: "Lora" },
  { value: "Nanum Gothic", label: "Nanum Gothic" },
];

export function EditorTab() {
  const { t } = useTranslation();
  const {
    fontFamily,
    setFontFamily,
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    tabSize,
    setTabSize,
    lineNumbers,
    setLineNumbers,
    autoPairBrackets,
    setAutoPairBrackets,
    editorMaxWidth,
    setEditorMaxWidth,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.editor.font")} />

      <SettingsRow
        description={t("settings.editor.fontFamily.desc")}
        label={t("settings.editor.fontFamily")}
      >
        <FontFamilyPicker onChange={setFontFamily} value={fontFamily} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.fontSize.desc").replace(
          "{value}",
          String(fontSize),
        )}
        label={t("settings.editor.fontSize")}
      >
        <input
          className="settings-range"
          max={32}
          min={8}
          onChange={(e) => setFontSize(Number(e.target.value))}
          step={1}
          type="range"
          value={fontSize}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.lineHeight.desc").replace(
          "{value}",
          lineHeight.toFixed(2),
        )}
        label={t("settings.editor.lineHeight")}
      >
        <input
          className="settings-range"
          max={3.0}
          min={1.0}
          onChange={(e) => setLineHeight(Number(e.target.value))}
          step={0.05}
          type="range"
          value={lineHeight}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.behavior")} />

      <SettingsRow
        description={t("settings.editor.tabSize.desc")}
        label={t("settings.editor.tabSize")}
      >
        <select
          className="settings-select"
          onChange={(e) => setTabSize(Number(e.target.value))}
          value={tabSize}
        >
          <option value={2}>{t("settings.editor.tabSize.2spaces")}</option>
          <option value={4}>{t("settings.editor.tabSize.4spaces")}</option>
        </select>
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.autoPairBrackets.desc")}
        label={t("settings.editor.autoPairBrackets")}
      >
        <ToggleSwitch
          checked={autoPairBrackets}
          onChange={setAutoPairBrackets}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.display")} />

      <SettingsRow
        description={t("settings.editor.lineNumbers.desc")}
        label={t("settings.editor.lineNumbers")}
      >
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.maxWidth.desc").replace(
          "{value}",
          editorMaxWidth === 0
            ? t("settings.editor.maxWidth.noLimit")
            : editorMaxWidth + "px",
        )}
        label={t("settings.editor.maxWidth")}
      >
        <input
          className="settings-range"
          max={2048}
          min={0}
          onChange={(e) => setEditorMaxWidth(Number(e.target.value))}
          step={50}
          type="range"
          value={editorMaxWidth}
        />
      </SettingsRow>
    </div>
  );
}

// ─── Editor Tab ─────────────────────────────────────────

function FontFamilyPicker({
  value,
  onChange,
}: {
  onChange: (v: string) => void;
  value: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = search
    ? FONT_OPTIONS.filter((f) =>
        f.label.toLowerCase().includes(search.toLowerCase()),
      )
    : FONT_OPTIONS;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSelect = (fontValue: string) => {
    onChange(fontValue);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="settings-font-picker" ref={containerRef}>
      <input
        className="settings-input"
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setSearch("");
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && search) {
            // Allow custom font name
            onChange(search);
            setSearch("");
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={t("settings.editor.fontPicker.placeholder")}
        type="text"
        value={open ? search : value}
      />
      {open && (
        <div className="settings-font-dropdown">
          {filtered.map((font) => (
            <button
              className={`settings-font-option ${font.value === value ? "settings-font-option-active" : ""}`}
              key={font.value}
              onClick={() => handleSelect(font.value)}
              style={{ fontFamily: font.value }}
            >
              {font.value === "system-ui"
                ? t("settings.editor.fontPicker.systemDefault")
                : font.label}
            </button>
          ))}
          {filtered.length === 0 && search && (
            <button
              className="settings-font-option"
              onClick={() => handleSelect(search)}
            >
              {t("settings.editor.fontPicker.useCustom").replace(
                "{font}",
                search,
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
