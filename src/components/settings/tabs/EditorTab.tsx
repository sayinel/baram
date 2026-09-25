import { useEffect, useState } from "react";

import type { FontListState } from "../../../utils/font/font-list-state";
import type { FontSlot } from "../FontSlotPicker";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { listFonts } from "../../../ipc/font";
import { useSettingsStore } from "../../../stores/settings/store";
import { resolveCodeMetrics } from "../../../utils/font/code-metrics";
import {
  badgeFonts,
  fontListStateFrom,
} from "../../../utils/font/font-list-state";
import {
  fontSizeNumber,
  lineHeightNumber,
} from "../../../utils/font/font-metric-text";
import { AppearanceDialRow } from "../appearance-dial-row";
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
    linkFontMetrics,
    setLinkFontMetrics,
    codeFontSize,
    setCodeFontSize,
    codeLineHeight,
    setCodeLineHeight,
    tabSize,
    setTabSize,
    lineNumbers,
    setLineNumbers,
    autoPairBrackets,
    setAutoPairBrackets,
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
      codeFontSize: s.codeFontSize,
      codeLineHeight: s.codeLineHeight,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      lineNumbers: s.lineNumbers,
      linkFontMetrics: s.linkFontMetrics,
      recentFonts: s.recentFonts,
      setAutoLoadVideoEmbeds: s.setAutoLoadVideoEmbeds,
      setAutoPairBrackets: s.setAutoPairBrackets,
      setCodeFontFamily: s.setCodeFontFamily,
      setCodeFontSize: s.setCodeFontSize,
      setCodeLineHeight: s.setCodeLineHeight,
      setFontFamily: s.setFontFamily,
      setFontSize: s.setFontSize,
      setLineHeight: s.setLineHeight,
      setLineNumbers: s.setLineNumbers,
      setLinkFontMetrics: s.setLinkFontMetrics,
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
  // §354 코드 슬롯의 예제와 아래 두 슬라이더가 보여 주는 값 — 연동 중이면
  // 본문에서 파생한 것이고, 끄면 저장된 코드 값이다. 이 자리에서 다시 계산하지
  // 않는다: 같은 답을 내야 하는 곳이 여럿이라 계산은 code-metrics.ts 하나뿐이다.
  const codeMetrics = resolveCodeMetrics({
    codeFontSize,
    codeLineHeight,
    fontSize,
    lineHeight,
    linkFontMetrics,
  });

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
          fontSize={fontSize}
          lineHeight={lineHeight}
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
          fontSize={codeMetrics.fontSize}
          lineHeight={codeMetrics.lineHeight}
          onChange={setCodeFontFamily}
          onOpenBrowser={setBrowserSlot}
          slot="code"
          value={codeFontFamily}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.fontSize.desc").replace(
          "{value}",
          fontSizeNumber(fontSize),
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
          lineHeightNumber(lineHeight),
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

      <SettingsRow
        description={t("settings.editor.linkFontMetrics.desc")}
        label={t("settings.editor.linkFontMetrics")}
      >
        <ToggleSwitch checked={linkFontMetrics} onChange={setLinkFontMetrics} />
      </SettingsRow>

      {/* 연동 중에도 두 행을 숨기지 않고 끈 채로 둔다 — 코드가 지금 몇 px 인지는
          연동 여부와 무관하게 궁금한 값이고, 행이 사라지면 "어디서 바꾸지?" 가
          된다. 값은 파생값이라 슬라이더가 실제 상태를 그대로 가리킨다. */}
      <SettingsRow
        description={t("settings.editor.codeFontSize.desc").replace(
          "{value}",
          fontSizeNumber(Math.round(codeMetrics.fontSize)),
        )}
        label={t("settings.editor.codeFontSize")}
      >
        <input
          className="settings-range"
          disabled={linkFontMetrics}
          max={32}
          min={8}
          onChange={(e) => setCodeFontSize(Number(e.target.value))}
          step={1}
          type="range"
          value={Math.round(codeMetrics.fontSize)}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.codeLineHeight.desc").replace(
          "{value}",
          lineHeightNumber(codeMetrics.lineHeight),
        )}
        label={t("settings.editor.codeLineHeight")}
      >
        <input
          className="settings-range"
          disabled={linkFontMetrics}
          max={3.0}
          min={1.0}
          onChange={(e) => setCodeLineHeight(Number(e.target.value))}
          step={0.05}
          type="range"
          value={codeMetrics.lineHeight}
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

      {/* §368 — 줄바꿈 규칙은 본문이 어떻게 흐르는지에 대한 것이라 폭·여백과
          한 덩어리다(스펙 §4.4). editorMaxWidth 바로 위에 둔다. */}
      <AppearanceDialRow
        dialId="editorLineBreak"
        label={t("settings.editor.editorLineBreak")}
      />

      {/* §368 — 자간·문단 간격도 같은 다이얼 기계를 쓰는 본문 조판 축이라
          줄바꿈 바로 다음에 둔다. */}
      <AppearanceDialRow
        dialId="editorLetterSpacing"
        label={t("settings.editor.editorLetterSpacing")}
      />
      <AppearanceDialRow
        dialId="editorParagraphSpacing"
        label={t("settings.editor.editorParagraphSpacing")}
      />

      {/* §368.2 — 강조 렌더링도 같은 다이얼 기계를 쓰는 조판 축이라 문단 간격
          바로 다음, 조판 다이얼들의 끝에 둔다. */}
      <AppearanceDialRow
        dialId="editorEmphasisStyle"
        label={t("settings.editor.editorEmphasisStyle")}
      />

      {/* §366 되돌림 — 이 둘은 §366에서 외관 다이얼로 바뀌며 잠시 Appearance
          탭으로 옮겨졌다가, 되돌아왔다(§366 후속 수정). 다이얼 기계(병합·테마
          층·출처 배지·되돌리기)는 AppearanceDialRow 안에 그대로 있다 — 탭을
          옮겨도 그 로직은 건드리지 않는다. */}
      <AppearanceDialRow
        dialId="editorMaxWidth"
        label={t("settings.editor.maxWidth")}
      />
      <AppearanceDialRow
        dialId="editorPadding"
        label={t("settings.appearance.editorPadding")}
      />

      {/* §369 — 리스트 들여쓰기 안내선의 농도. 조판 다이얼이 아니라 여백·폭과
          같은 "화면에 무엇이 얼마나 드러나는가" 축이라 그 둘 다음에 둔다.
          안내선의 **색조**는 여기 없다 — 그쪽은 테마가 고르는
          `--color-editor-guide-tint` 이고 Appearance 탭의 테마 편집기가 맡는다. */}
      <AppearanceDialRow
        dialId="editorListGuideStrength"
        label={t("settings.editor.editorListGuideStrength")}
      />

      {/* §5.1 — 순서 있는 리스트의 번호가 어느 쪽으로 자라는가. 안내선 농도와 같은
          리스트 기하 축이라 바로 다음에 둔다. */}
      <AppearanceDialRow
        dialId="editorOrderedMarkerAlign"
        label={t("settings.editor.editorOrderedMarkerAlign")}
      />

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
    </div>
  );
}
