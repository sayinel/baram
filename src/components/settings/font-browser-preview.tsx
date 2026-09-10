// §352 브라우저 우측 미리보기 — 본문(볼드·이탤릭·한영 혼합)과 코드 블록을
// 동시에 그려 body/code 페어링을 한눈에 보게 한다. 이름만으로는 "이게
// 괜찮아 보이는가"에 답하지 못한다 — 서체가 실제로 깨지는 자리들이다.
//
// 크기·줄간격 슬라이더는 설정 행과 같은 store 값을 그대로 쓴다 — 하나의
// 설정을 두 표면(행·브라우저)에서 조절하는 것이지, 별개의 설정이 아니다.
import type { FontSlot } from "./FontSlotPicker";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import {
  BASE_EDITOR_STACK,
  BASE_MONO_STACK,
} from "../../utils/editor/font-surfaces";
import { quoteFamily } from "../../utils/editor/quote-font-family";
import {
  SAMPLE_CODE,
  SAMPLE_EN,
  SAMPLE_GLYPHS,
  SAMPLE_KO,
} from "../../utils/font/font-sample-text";

interface Props {
  slot: FontSlot;
}

export function FontBrowserPreview({ slot }: Props) {
  const { t } = useTranslation();
  const {
    codeFontFamily,
    fontFamily,
    fontSize,
    lineHeight,
    setFontSize,
    setLineHeight,
  } = useSettingsStore(
    useShallow((s) => ({
      codeFontFamily: s.codeFontFamily,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      setFontSize: s.setFontSize,
      setLineHeight: s.setLineHeight,
    })),
  );

  const bodyStack =
    fontFamily.trim() === ""
      ? BASE_EDITOR_STACK
      : `${quoteFamily(fontFamily)}, ${BASE_EDITOR_STACK}`;
  const codeStack =
    codeFontFamily.trim() === ""
      ? BASE_MONO_STACK
      : `${quoteFamily(codeFontFamily)}, ${BASE_MONO_STACK}`;

  // 고빈도 경로의 store write는 동등성 관문 필수 — 값이 같으면 set을 호출하지
  // 않는다(드래그 중 같은 스텝에 머무는 이벤트가 흔하다).
  const onSize = (value: number) => {
    if (value !== fontSize) setFontSize(value);
  };
  const onLineHeight = (value: number) => {
    if (value !== lineHeight) setLineHeight(value);
  };

  return (
    <div className="font-browser-preview flex-col">
      <div className="font-browser-preview-controls">
        <label className="font-browser-preview-control">
          <span>{t("settings.editor.fontSize")}</span>
          <input
            className="settings-range"
            max={32}
            min={8}
            onChange={(e) => onSize(Number(e.target.value))}
            step={1}
            type="range"
            value={fontSize}
          />
        </label>
        <label className="font-browser-preview-control">
          <span>{t("settings.editor.lineHeight")}</span>
          <input
            className="settings-range"
            max={3.0}
            min={1.0}
            onChange={(e) => onLineHeight(Number(e.target.value))}
            step={0.05}
            type="range"
            value={lineHeight}
          />
        </label>
      </div>

      <div
        className={`font-browser-preview-body ${slot === "body" ? "font-browser-preview-active" : ""}`}
        data-testid="font-browser-preview-body"
        style={{ fontFamily: bodyStack, fontSize, lineHeight }}
      >
        <p>
          <strong>{SAMPLE_KO}</strong>
        </p>
        <p>
          <em>{SAMPLE_EN}</em>
        </p>
        <p className="font-browser-preview-glyphs">{SAMPLE_GLYPHS}</p>
      </div>

      <pre
        className={`font-browser-preview-code ${slot === "code" ? "font-browser-preview-active" : ""}`}
        data-testid="font-browser-preview-code"
        style={{ fontFamily: codeStack, fontSize, lineHeight }}
      >
        <code>{SAMPLE_CODE}</code>
      </pre>
    </div>
  );
}
