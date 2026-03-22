// Settings Registry — metadata for all searchable settings
// Phase 2: each entry carries SettingControlMeta for data-driven rendering
import type React from "react";

import type { Locale } from "../../i18n";

import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import { useAIStore } from "../../stores/ai/ai";
import { useSettingsStore } from "../../stores/settings/store";

export interface SearchableSetting {
  category: SettingsTab;
  control: SettingControlMeta;
  description: string;
  id: string;
  keywords?: string[];
  label: string;
  section: string;
}

export interface SettingControlMeta {
  controlType: "color" | "custom" | "input" | "select" | "slider" | "toggle";
  customRender?: (props: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (v: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  }) => React.ReactElement;
  options?: Array<{ label: string; value: string }>;
  range?: { max: number; min: number; step: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storeSelector: () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storeSetter: (value: any) => void;
}

export type SettingsTab =
  | "activitybar"
  | "ai"
  | "appearance"
  | "editor"
  | "general"
  | "keybindings"
  | "language"
  | "markdown"
  | "plugins"
  | "vault";

// Marker for settings that require navigation to their tab (no inline control)
export const NAVIGATE_CONTROL: SettingControlMeta = {
  controlType: "custom",
  storeSelector: () => null,
  storeSetter: () => undefined,
};

/**
 * Returns the full settings registry.
 * Must be called inside a React component (hooks are used internally).
 */
export function useSettingsRegistry(): SearchableSetting[] {
  const settings = useSettingsStore();
  const ai = useAIStore();

  return [
    // ── General ──────────────────────────────────────────────────────────────
    {
      id: "onLaunch",
      label: "settings.general.onLaunch",
      description: "settings.general.onLaunch.desc",
      category: "general",
      section: "settings.general.startup",
      control: makeSelectControl(
        () => settings.onLaunch,
        (v) =>
          settings.setOnLaunch(
            v as "newFile" | "restoreLastFile" | "restoreLastFolder",
          ),
        [
          {
            value: "restoreLastFolder",
            label: "settings.general.onLaunch.restoreLastFolder",
          },
          {
            value: "restoreLastFile",
            label: "settings.general.onLaunch.restoreLastFile",
          },
          { value: "newFile", label: "settings.general.onLaunch.newFile" },
        ],
      ),
    },
    {
      id: "autoSave",
      label: "settings.general.autoSave",
      description: "settings.general.autoSave.desc",
      category: "general",
      section: "settings.general.saving",
      control: makeToggleControl(() => settings.autoSave, settings.setAutoSave),
    },
    {
      id: "autoSaveDelay",
      label: "settings.general.saveDelay",
      description: "settings.general.saveDelay.desc",
      category: "general",
      section: "settings.general.saving",
      control: makeSliderControl(
        () => settings.autoSaveDelay,
        settings.setAutoSaveDelay,
        { min: 500, max: 10000, step: 500 },
      ),
    },
    {
      id: "spellCheck",
      label: "settings.general.spellCheck",
      description: "settings.general.spellCheck.desc",
      category: "general",
      section: "settings.general.system",
      control: makeToggleControl(
        () => settings.spellCheck,
        settings.setSpellCheck,
      ),
    },
    {
      id: "wikilinkFormat",
      label: "settings.general.linkFormat",
      description: "settings.general.linkFormat.desc",
      category: "general",
      section: "settings.general.links",
      keywords: ["wikilink", "markdown", "link"],
      control: makeSelectControl(
        () => settings.wikilinkFormat,
        (v) => settings.setWikilinkFormat(v as "markdown" | "wikilink"),
        [
          { value: "wikilink", label: "[[Wikilink]]" },
          { value: "markdown", label: "[Markdown](link)" },
        ],
      ),
    },
    {
      id: "autoUpdateLinks",
      label: "settings.general.autoUpdateLinks",
      description: "settings.general.autoUpdateLinks.desc",
      category: "general",
      section: "settings.general.links",
      control: makeToggleControl(
        () => settings.autoUpdateLinks,
        settings.setAutoUpdateLinks,
      ),
    },
    {
      id: "snapshotInterval",
      label: "settings.general.snapshotInterval",
      description: "settings.general.snapshotInterval.desc",
      category: "general",
      section: "settings.general.snapshots",
      keywords: ["version", "history", "backup"],
      control: makeSliderControl(
        () => settings.snapshotInterval,
        settings.setSnapshotInterval,
        { min: 0, max: 120, step: 5 },
      ),
    },
    {
      id: "snapshotMaxCount",
      label: "settings.general.snapshotMaxCount",
      description: "settings.general.snapshotMaxCount.desc",
      category: "general",
      section: "settings.general.snapshots",
      control: makeSliderControl(
        () => settings.snapshotMaxCount,
        settings.setSnapshotMaxCount,
        { min: 5, max: 200, step: 5 },
      ),
    },
    {
      id: "journalEnabled",
      label: "settings.general.journalEnabled",
      description: "settings.general.journalEnabled.desc",
      category: "general",
      section: "settings.general.journal",
      keywords: ["daily", "note", "diary"],
      control: makeToggleControl(
        () => settings.journalEnabled,
        settings.setJournalEnabled,
      ),
    },
    // ── Editor ───────────────────────────────────────────────────────────────
    {
      id: "fontFamily",
      label: "settings.editor.fontFamily",
      description: "settings.editor.fontFamily.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["typeface", "font"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "fontSize",
      label: "settings.editor.fontSize",
      description: "settings.editor.fontSize.desc",
      category: "editor",
      section: "settings.editor.font",
      control: makeSliderControl(
        () => settings.fontSize,
        settings.setFontSize,
        { min: 8, max: 32, step: 1 },
      ),
    },
    {
      id: "lineHeight",
      label: "settings.editor.lineHeight",
      description: "settings.editor.lineHeight.desc",
      category: "editor",
      section: "settings.editor.font",
      control: makeSliderControl(
        () => settings.lineHeight,
        settings.setLineHeight,
        { min: 1.0, max: 3.0, step: 0.05 },
      ),
    },
    {
      id: "tabSize",
      label: "settings.editor.tabSize",
      description: "settings.editor.tabSize.desc",
      category: "editor",
      section: "settings.editor.behavior",
      keywords: ["indent", "space"],
      control: makeSelectControl(
        () => String(settings.tabSize),
        (v) => settings.setTabSize(Number(v)),
        [
          { value: "2", label: "settings.editor.tabSize.2spaces" },
          { value: "4", label: "settings.editor.tabSize.4spaces" },
        ],
      ),
    },
    {
      id: "autoPairBrackets",
      label: "settings.editor.autoPairBrackets",
      description: "settings.editor.autoPairBrackets.desc",
      category: "editor",
      section: "settings.editor.behavior",
      control: makeToggleControl(
        () => settings.autoPairBrackets,
        settings.setAutoPairBrackets,
      ),
    },
    {
      id: "lineNumbers",
      label: "settings.editor.lineNumbers",
      description: "settings.editor.lineNumbers.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeToggleControl(
        () => settings.lineNumbers,
        settings.setLineNumbers,
      ),
    },
    {
      id: "editorMaxWidth",
      label: "settings.editor.maxWidth",
      description: "settings.editor.maxWidth.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeSliderControl(
        () => settings.editorMaxWidth,
        settings.setEditorMaxWidth,
        { min: 0, max: 2048, step: 50 },
      ),
    },
    // ── Appearance ───────────────────────────────────────────────────────────
    {
      id: "activeThemeId",
      label: "settings.appearance.theme",
      description: "settings.appearance.theme",
      category: "appearance",
      section: "settings.appearance.theme",
      keywords: ["dark", "light", "color", "theme"],
      control: NAVIGATE_CONTROL,
    },
    // ── Markdown ─────────────────────────────────────────────────────────────
    {
      id: "inlineMath",
      label: "settings.markdown.inlineMath",
      description: "settings.markdown.inlineMath.desc",
      category: "markdown",
      section: "settings.markdown.extendedSyntax",
      keywords: ["katex", "latex", "equation"],
      control: makeToggleControl(
        () => settings.inlineMath,
        settings.setInlineMath,
      ),
    },
    {
      id: "highlight",
      label: "settings.markdown.highlight",
      description: "settings.markdown.highlight.desc",
      category: "markdown",
      section: "settings.markdown.extendedSyntax",
      control: makeToggleControl(
        () => settings.highlight,
        settings.setHighlight,
      ),
    },
    {
      id: "strikethrough",
      label: "settings.markdown.strikethrough",
      description: "settings.markdown.strikethrough.desc",
      category: "markdown",
      section: "settings.markdown.extendedSyntax",
      control: makeToggleControl(
        () => settings.strikethrough,
        settings.setStrikethrough,
      ),
    },
    {
      id: "smartPunctuation",
      label: "settings.markdown.smartPunctuation",
      description: "settings.markdown.smartPunctuation.desc",
      category: "markdown",
      section: "settings.markdown.typography",
      control: makeToggleControl(
        () => settings.smartPunctuation,
        settings.setSmartPunctuation,
      ),
    },
    // ── AI ───────────────────────────────────────────────────────────────────
    {
      id: "provider",
      label: "settings.ai.aiProvider",
      description: "settings.ai.aiProvider.desc",
      category: "ai",
      section: "settings.ai.provider",
      keywords: ["claude", "openai", "ollama", "gemini"],
      control: makeSelectControl(
        () => ai.provider,
        (v) => ai.setProvider(v as "claude" | "gemini" | "ollama" | "openai"),
        [
          { value: "claude", label: "settings.ai.provider.claude" },
          { value: "openai", label: "settings.ai.provider.openai" },
          { value: "gemini", label: "settings.ai.provider.gemini" },
          { value: "ollama", label: "settings.ai.provider.ollama" },
        ],
      ),
    },
    {
      id: "apiKey",
      label: "settings.ai.apiKey",
      description: "settings.ai.apiKey",
      category: "ai",
      section: "settings.ai.provider",
      control: NAVIGATE_CONTROL,
    },
    {
      id: "model",
      label: "settings.ai.model",
      description: "settings.ai.model.desc",
      category: "ai",
      section: "settings.ai.provider",
      control: NAVIGATE_CONTROL,
    },
    {
      id: "ghostTextEnabled",
      label: "settings.ai.ghostTextEnabled",
      description: "settings.ai.ghostTextEnabled.desc",
      category: "ai",
      section: "settings.ai.ghostText",
      keywords: ["autocomplete", "suggestion"],
      control: makeToggleControl(
        () => ai.ghostTextEnabled,
        ai.setGhostTextEnabled,
      ),
    },
    {
      id: "privacyMode",
      label: "settings.ai.privacyMode",
      description: "settings.ai.privacyMode.desc",
      category: "ai",
      section: "settings.ai.privacy",
      control: makeToggleControl(() => ai.privacyMode, ai.setPrivacyMode),
    },
    // ── Activity Bar ─────────────────────────────────────────────────────────
    {
      id: "activityBarConfig",
      label: "settings.tab.activitybar",
      description: "settings.activitybar.desc",
      category: "activitybar",
      section: "settings.tab.activitybar",
      keywords: ["icon", "sidebar", "panel"],
      control: NAVIGATE_CONTROL,
    },
    // ── Language ─────────────────────────────────────────────────────────────
    {
      id: "locale",
      label: "settings.language.title",
      description: "settings.language.interface.desc",
      category: "language",
      section: "settings.language.title",
      keywords: ["locale", "i18n", "korean", "english", "한국어"],
      control: makeSelectControl(
        () => settings.locale,
        (v) => settings.setLocale(v),
        AVAILABLE_LOCALES.map((loc: Locale) => ({
          value: loc,
          label: LOCALE_LABELS[loc],
        })),
      ),
    },
    // ── Keybindings ──────────────────────────────────────────────────────────
    {
      id: "keybindings",
      label: "settings.tab.keybindings",
      description: "",
      category: "keybindings",
      section: "settings.tab.keybindings",
      keywords: [
        "shortcut",
        "key",
        "binding",
        "hotkey",
        "keyboard",
        "remap",
        "단축키",
        "키보드",
        "바인딩",
      ],
      control: NAVIGATE_CONTROL,
    },
  ];
}

function makeSelectControl(
  selector: () => number | string,
  setter: (v: string) => void,
  options: Array<{ label: string; value: string }>,
): SettingControlMeta {
  return {
    controlType: "select",
    storeSelector: selector,
    storeSetter: setter as (v: unknown) => void,
    options,
  };
}

function makeSliderControl(
  selector: () => number,
  setter: (v: number) => void,
  range: { max: number; min: number; step: number },
): SettingControlMeta {
  return {
    controlType: "slider",
    storeSelector: selector,
    storeSetter: setter as (v: unknown) => void,
    range,
  };
}

function makeToggleControl(
  selector: () => boolean,
  setter: (v: boolean) => void,
): SettingControlMeta {
  return {
    controlType: "toggle",
    storeSelector: selector,
    storeSetter: setter as (v: unknown) => void,
  };
}
