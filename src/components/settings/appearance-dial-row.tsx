// §366 다이얼 한 줄. 이 행의 출처 칸은 `dial-origin-slot.tsx` 가 그린다 — 입력이 다른 행(서체 ·
// 본문 폭)이 같은 칸을 쓴다.

import type { DialId } from "../../appearance/dials";
import type { Translate } from "../../i18n/useTranslation";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { dialOptionLabelKey } from "./dial-option-label";
import { DialOriginSlot } from "./dial-origin-slot";
import { formatDialValue } from "./dial-value-format";
import { SettingsRow } from "./settings-shared";

interface AppearanceDialRowProps {
  readonly dialId: DialId;
  readonly label: string;
}

export function AppearanceDialRow({ dialId, label }: AppearanceDialRowProps) {
  const { t } = useTranslation();
  const { appearanceOverrides } = useSettingsStore(
    useShallow((s) => ({ appearanceOverrides: s.appearanceOverrides })),
  );
  const themeDials = useThemeDials();
  const dial = DIALS.find((d) => d.id === dialId);
  if (!dial) return null;
  // §365 서체 다이얼(`text`)은 이 행이 그리지 않는다 — 입력이 슬라이더도 select 도 아닌 서체
  // 선택기(`FontSlotPicker`)라, 에디터 탭이 그 선택기 옆에 출처 칸만 붙인다(스펙 0060 §7.1).
  if (dial.kind === "text") return null;

  const resolved = resolveDials(themeDials, appearanceOverrides)[dialId];

  const control =
    dial.kind === "number" ? (
      <input
        className="settings-range"
        max={dial.range.max}
        min={dial.range.min}
        onChange={(e) =>
          useSettingsStore.getState().setDial(dialId, Number(e.target.value))
        }
        step={dial.range.step}
        type="range"
        value={
          typeof resolved.value === "number"
            ? resolved.value
            : dial.defaultValue
        }
      />
    ) : (
      // 열거는 슬라이더가 아니라 select 다. `.settings-select`(`src/styles/
      // settings/modal.css`)는 이 모달의 다른 select 들이 이미 쓰는
      // 클래스다 — 새 스타일을 만들지 않는다.
      <select
        className="settings-select"
        onChange={(e) =>
          useSettingsStore.getState().setDial(dialId, e.target.value)
        }
        value={String(resolved.value)}
      >
        {dial.options.map((option) => (
          <option key={option} value={option}>
            {t(dialOptionLabelKey(dialId, option))}
          </option>
        ))}
      </select>
    );

  return (
    <SettingsRow description={describeDial(dialId, t)} label={label}>
      {control}
      {/* 값 읽기 전용 슬롯(`.settings-dial-value`, modal.css) — 값을 description
          안 괄호에서 꺼내 여기로 옮겼다(§366 후속 수정). description은 이제
          로케일별 상수라 줄바꿈 여부가 값 길이에 따라 흔들리지 않는다: 드래그로
          "(6rem)"이 "(6.5rem)"이 되던 예전에는 그 한 글자가 description 줄 수를
          뒤집어 아래 모든 행을 밀어 올렸다(§366 버그 리포트, "떨려 보인다"). */}
      <span className="settings-dial-value" data-testid="dial-value">
        {formatDialValue(dialId, resolved.value, t)}
      </span>
      <DialOriginSlot dialId={dialId} />
    </SettingsRow>
  );
}

/**
 * 행 설명 — 값이 빠진 로케일별 상수 문장. `settings.editor.maxWidth.desc` /
 * `settings.appearance.editorPadding.desc`는 더 이상 `{value}` 자리표시자를
 * 신지 않는다(§366 후속 수정) — 값은 `formatDialValue`가 따로 반환한다.
 */
function describeDial(dialId: DialId, t: Translate): string {
  switch (dialId) {
    case "accentHueShift":
      return t("settings.appearance.accentHueShift.desc");
    case "accentSaturationShift":
      return t("settings.appearance.accentSaturationShift.desc");
    case "backgroundContrastDark":
      return t("settings.appearance.backgroundContrastDark.desc");
    case "backgroundContrastLight":
      return t("settings.appearance.backgroundContrastLight.desc");
    case "cornerRadius":
      return t("settings.appearance.cornerRadius.desc");
    case "density":
      return t("settings.appearance.density.desc");
    case "editorCodeFontFamily":
      return t("settings.editor.codeFontFamily.desc");
    case "editorEmphasisStyle":
      return t("settings.editor.editorEmphasisStyle.desc");
    case "editorFontFamily":
      return t("settings.editor.fontFamily.desc");
    case "editorFontSize":
      return t("settings.editor.fontSize.desc");
    case "editorLetterSpacing":
      return t("settings.editor.editorLetterSpacing.desc");
    case "editorLineBreak":
      return t("settings.editor.editorLineBreak.desc");
    case "editorLineHeight":
      return t("settings.editor.lineHeight.desc");
    case "editorListGuideStrength":
      return t("settings.editor.editorListGuideStrength.desc");
    case "editorMaxWidth":
      return t("settings.editor.maxWidth.desc");
    case "editorOrderedMarkerAlign":
      return t("settings.editor.editorOrderedMarkerAlign.desc");
    case "editorPadding":
      return t("settings.appearance.editorPadding.desc");
    case "editorParagraphSpacing":
      return t("settings.editor.editorParagraphSpacing.desc");
  }
}
