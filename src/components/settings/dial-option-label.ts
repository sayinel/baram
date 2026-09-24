// §365 · §368 — enum 다이얼 옵션의 라벨 키. 행(`appearance-dial-row.tsx`)과 검색
// 항목(`settings-registry.ts`)이 **이 함수 하나**를 부른다. 둘이 각자 키를 지으면
// 검색으로 찾은 옵션과 행의 옵션이 다른 이름을 갖는 날이 온다(스펙 0055 §4.4).
import type { DialId } from "../../appearance/dials";

export function dialOptionLabelKey(dialId: DialId, option: string): string {
  return `${optionNamespace(dialId)}.${dialId}.${option}`;
}

/**
 * 그 다이얼의 옵션 라벨이 사는 i18n 네임스페이스.
 *
 * ‼️ `default` 갈래가 없다 — 다이얼을 더하면 이 switch 가 TS2366 으로 컴파일을
 * 멈춰, 새 다이얼의 키가 어디 사는지 정하게 한다. number 다이얼은 옵션이 없어
 * 이 값을 읽는 곳이 없다. 갈래가 있는 것은 망라성 때문이다.
 */
function optionNamespace(
  dialId: DialId,
): "settings.appearance" | "settings.editor" {
  switch (dialId) {
    case "accentHueShift":
    case "accentSaturationShift":
    case "backgroundContrastDark":
    case "backgroundContrastLight":
    case "cornerRadius":
    case "density":
    case "editorPadding":
      return "settings.appearance";
    case "editorEmphasisStyle":
    case "editorLetterSpacing":
    case "editorLineBreak":
    case "editorListGuideStrength":
    case "editorMaxWidth":
    case "editorOrderedMarkerAlign":
    case "editorParagraphSpacing":
      return "settings.editor";
  }
}
