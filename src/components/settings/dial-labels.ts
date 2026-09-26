// §371 6a — 다이얼마다 설정 행이 쓰는 라벨 키와, 값을 한 줄로 적는 문구(스펙 0062 §4). 외관 내보내기의
// 요약이 설정 행과 같은 이름 · 같은 모양으로 다이얼을 부르게 한다. 라벨 키가 설정 검색 항목의 `label` 과
// 같다는 것은 `__tests__/dial-labels.test.ts` 가 고정한다.
import type { DialId, DialValue } from "../../appearance/dials";
import type { Translate } from "../../i18n/useTranslation";

import { DIALS } from "../../appearance/dials";
import { dialOptionLabelKey } from "./dial-option-label";
import { formatDialValue } from "./dial-value-format";

/** `Record` 라 다이얼을 더하고 라벨을 빠뜨리면 컴파일이 멈춘다. */
export const DIAL_LABEL_KEY: Readonly<Record<DialId, string>> = {
  accentHueShift: "settings.appearance.accentHueShift",
  accentSaturationShift: "settings.appearance.accentSaturationShift",
  backgroundContrastDark: "settings.appearance.backgroundContrastDark",
  backgroundContrastLight: "settings.appearance.backgroundContrastLight",
  cornerRadius: "settings.appearance.cornerRadius",
  density: "settings.appearance.density",
  editorCodeFontFamily: "settings.editor.codeFontFamily",
  editorEmphasisStyle: "settings.editor.editorEmphasisStyle",
  editorFontFamily: "settings.editor.fontFamily",
  editorFontSize: "settings.editor.fontSize",
  editorLetterSpacing: "settings.editor.editorLetterSpacing",
  editorLineBreak: "settings.editor.editorLineBreak",
  editorLineHeight: "settings.editor.lineHeight",
  editorListGuideStrength: "settings.editor.editorListGuideStrength",
  editorMaxWidth: "settings.editor.maxWidth",
  editorOrderedMarkerAlign: "settings.editor.editorOrderedMarkerAlign",
  editorPadding: "settings.appearance.editorPadding",
  editorParagraphSpacing: "settings.editor.editorParagraphSpacing",
};

/**
 * 값 하나를 요약 줄의 문구로. 열거는 옵션 라벨 — 설정 행의 `formatDialValue` 는 열거에 빈 문자열을
 * 돌려주는데(select 가 이미 보여 주므로), 요약에는 select 가 없다. 빈 서체는 서체 선택기와 같은 "시스템 기본".
 */
export function dialValueSummary(
  id: DialId,
  value: DialValue,
  t: Translate,
): string {
  const dial = DIALS.find((d) => d.id === id);
  if (dial?.kind === "enum") return t(dialOptionLabelKey(id, String(value)));
  if (dial?.kind === "text" && value === "")
    return t("settings.editor.fontPicker.systemDefault");
  return formatDialValue(id, value, t);
}
