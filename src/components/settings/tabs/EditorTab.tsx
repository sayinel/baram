import { useEffect, useState } from "react";

import type { FontListState } from "../../../utils/font/font-list-state";
import type { FontSlot } from "../FontSlotPicker";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { listFonts } from "../../../ipc/font";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  badgeFonts,
  fontListStateFrom,
} from "../../../utils/font/font-list-state";
import { FontBrowser } from "../FontBrowser";
import { FontSlotPicker } from "../FontSlotPicker";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";

export function EditorTab() {
  const { t } = useTranslation();
  const {
    fontFamily,
    setFontFamily,
    codeFontFamily,
    setCodeFontFamily,
    recentFonts,
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
    virtualizeLargeDocs,
    setVirtualizeLargeDocs,
    autoLoadVideoEmbeds,
    setAutoLoadVideoEmbeds,
    vimMode,
    setVimMode,
  } = useSettingsStore(
    useShallow((s) => ({
      autoLoadVideoEmbeds: s.autoLoadVideoEmbeds,
      autoPairBrackets: s.autoPairBrackets,
      codeFontFamily: s.codeFontFamily,
      editorMaxWidth: s.editorMaxWidth,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      lineNumbers: s.lineNumbers,
      recentFonts: s.recentFonts,
      setAutoLoadVideoEmbeds: s.setAutoLoadVideoEmbeds,
      setAutoPairBrackets: s.setAutoPairBrackets,
      setCodeFontFamily: s.setCodeFontFamily,
      setEditorMaxWidth: s.setEditorMaxWidth,
      setFontFamily: s.setFontFamily,
      setFontSize: s.setFontSize,
      setLineHeight: s.setLineHeight,
      setLineNumbers: s.setLineNumbers,
      setTabSize: s.setTabSize,
      setVimMode: s.setVimMode,
      setVirtualizeLargeDocs: s.setVirtualizeLargeDocs,
      tabSize: s.tabSize,
      vimMode: s.vimMode,
      virtualizeLargeDocs: s.virtualizeLargeDocs,
    })),
  );

  // ‼️ Three states, not two (final review I3). "Still loading" and "the
  // enumeration failed, here is a stand-in list" both have to render no
  // confident "missing" badge — but they must NOT look the same to the
  // browser, which used to say "Loading fonts…" forever on a failure. The
  // badge asks `badgeFonts()`, which answers `null` for both; the browser
  // reads the state and can tell them apart.
  const [fontState, setFontState] = useState<FontListState>({
    status: "loading",
  });
  const [browserSlot, setBrowserSlot] = useState<FontSlot | null>(null);

  // §350 — 탭이 지연 로드 경계 뒤에 있으므로 마운트 시 1회 호출로 충분하다
  // (설계 §351: "피커를 처음 열 때"가 이상적이나 이 탭 자체가 이미 그 경계다).
  useEffect(() => {
    let cancelled = false;
    void listFonts().then((result) => {
      if (cancelled) return;
      setFontState(fontListStateFrom(result));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // §352 (Task 6) — owns its own close the way AppearanceTab's
  // <ThemeEditor onClose={…}/> does (review Important 3: a real back
  // control, not a blank pane).
  if (browserSlot) {
    return (
      <FontBrowser
        onClose={() => setBrowserSlot(null)}
        recentFonts={recentFonts}
        slot={browserSlot}
        state={fontState}
      />
    );
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.editor.font")} />

      <SettingsRow
        description={t("settings.editor.fontFamily.desc")}
        label={t("settings.editor.fontFamily")}
      >
        <FontSlotPicker
          fonts={badgeFonts(fontState)}
          onChange={setFontFamily}
          onOpenBrowser={setBrowserSlot}
          slot="body"
          value={fontFamily}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.codeFontFamily.desc")}
        label={t("settings.editor.codeFontFamily")}
      >
        <FontSlotPicker
          fonts={badgeFonts(fontState)}
          onChange={setCodeFontFamily}
          onOpenBrowser={setBrowserSlot}
          slot="code"
          value={codeFontFamily}
        />
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

      <SettingsRow
        description={t("settings.editor.vimMode.desc")}
        label={t("settings.editor.vimMode")}
      >
        <ToggleSwitch checked={vimMode} onChange={setVimMode} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.display")} />

      <SettingsRow
        description={t("settings.editor.lineNumbers.desc")}
        label={t("settings.editor.lineNumbers")}
      >
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.virtualizeLargeDocs.desc")}
        label={t("settings.editor.virtualizeLargeDocs")}
      >
        <ToggleSwitch
          checked={virtualizeLargeDocs}
          onChange={setVirtualizeLargeDocs}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.autoLoadVideoEmbeds.desc")}
        label={t("settings.editor.autoLoadVideoEmbeds")}
      >
        <ToggleSwitch
          checked={autoLoadVideoEmbeds}
          onChange={setAutoLoadVideoEmbeds}
        />
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
