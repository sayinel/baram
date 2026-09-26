// §366 다이얼 한 줄. 이 행의 출처 칸은 `dial-origin-slot.tsx` 가 그린다 — 입력이 다른 행(서체 ·
// 본문 폭)이 같은 칸을 쓴다.

import type { DialId, DialValue } from "../../appearance/dials";
import type { Translate } from "../../i18n/useTranslation";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import {
  fontSizeNumber,
  lineHeightNumber,
} from "../../utils/font/font-metric-text";
import { dialOptionLabelKey } from "./dial-option-label";
import { DialOriginSlot } from "./dial-origin-slot";
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

/**
 * `step`이 함의하는 소수 자릿수. `editorLetterSpacing`(step 0.005)처럼 소수
 * step을 가진 다이얼은 range 슬라이더가 부동소수 오차가 낀 값(예:
 * `-0.019999999999999997`)을 돌려줄 수 있다 — `inRange`는 step 정렬을
 * 검사하지 않으므로 그 값도 그대로 통과한다. 여기서 반올림하지 않으면 그
 * 오차가 고정폭 `.settings-dial-value` 슬롯을 넘쳐 §366이 막으려던 떨림이
 * 되돌아온다.
 */
function stepDecimalPlaces(step: number): number {
  const s = step.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * `dialId`의 `range.step`에서 소수 자릿수를 파생해 `value`를 반올림한다.
 * 값 자체(저장분)는 건드리지 않는다 — 이 함수는 표시 문구에서만 쓴다.
 * enum 다이얼이나 알 수 없는 id는 그대로 돌려준다.
 */
function roundToDialStep(dialId: DialId, value: number): number {
  const dial = DIALS.find((d) => d.id === dialId);
  if (!dial || dial.kind !== "number") return value;
  return Number(value.toFixed(stepDecimalPlaces(dial.range.step)));
}

/**
 * 값 읽기 문구 — 단위(px/rem)와 "제한 없음" 표기가 다이얼마다 다르다.
 * `editorLineBreak`는 빈 문자열을 돌려준다 — 열거의 값 readout은 select
 * 자체가 이미 보여 주므로, 여기서 같은 값을 문장으로 또 적으면 중복이다.
 */
function formatDialValue(
  dialId: DialId,
  value: DialValue,
  t: Translate,
): string {
  const rounded =
    typeof value === "number" ? roundToDialStep(dialId, value) : value;
  switch (dialId) {
    // §367 두 강조 다이얼은 **이동량**이라 부호가 값의 일부다 — `+60°` 와 `60°` 는
    // 같은 값이지만 `-60°` 와는 다르고, 0 을 기준으로 양쪽으로 움직이는 슬라이더에서
    // 부호 없는 readout 은 어느 쪽인지 말하지 않는다. 음수는 `-` 가 이미 붙는다.
    case "accentHueShift":
      return `${signOf(rounded)}${rounded}°`;
    case "accentSaturationShift":
      return `${signOf(rounded)}${rounded}%`;
    // editorLineBreak 과 같은 이유로 빈 문자열이다 — 열거의 값 readout 은 select
    // 자체가 이미 보여 준다.
    case "backgroundContrastDark":
    case "backgroundContrastLight":
    case "cornerRadius":
    case "density":
      return "";
    // 서체 다이얼은 이 행이 그리지 않는다(위 `text` 거절) — switch 가 `default` 없는 전수라
    // 자리만 있다.
    case "editorCodeFontFamily":
    case "editorFontFamily":
      return typeof value === "string" ? value : "";
    case "editorEmphasisStyle":
      // editorLineBreak와 같은 이유로 빈 문자열이다 — 열거의 값 readout은
      // select 자체가 이미 보여 준다.
      return "";
    // 서체 브라우저와 같은 자릿수 — `font-metric-text.ts` 가 두 표면의 모양을 한 곳에 둔다.
    case "editorFontSize":
      return typeof rounded === "number" ? `${fontSizeNumber(rounded)}px` : "";
    case "editorLetterSpacing":
      return `${rounded}em`;
    case "editorLineBreak":
      return "";
    case "editorLineHeight":
      return typeof rounded === "number" ? lineHeightNumber(rounded) : "";
    // `editorMaxWidth` 처럼 0 에 별도 문구를 두지 않는다. 거기서 0 은 "무제한" 이라
    // `0px` 가 정반대를 읽히게 하지만, 여기서 0 은 글자 그대로 "색조를 0% 섞는다" 다
    // — `0%` 가 사실이고, 그것이 보이지 않는다는 것은 설명문이 말한다.
    case "editorListGuideStrength":
      return `${rounded}%`;
    case "editorMaxWidth":
      return rounded === 0
        ? t("settings.editor.maxWidth.noLimit")
        : `${rounded}px`;
    // editorLineBreak·editorEmphasisStyle 과 같은 이유로 빈 문자열이다 — 열거의
    // 값 readout 은 select 자체가 이미 보여 준다.
    case "editorOrderedMarkerAlign":
      return "";
    case "editorPadding":
      return `${rounded}rem`;
    case "editorParagraphSpacing":
      return `${rounded}em`;
  }
}

/**
 * 양수 앞의 `+`. 음수는 숫자 자체가 `-` 를 싣고, 0 은 부호가 없다.
 * `DialValue` 는 문자열일 수 있으므로(열거 다이얼) 숫자일 때만 판정한다 —
 * 이 헬퍼를 부르는 자리는 오늘 number 다이얼 둘뿐이지만, 타입은 그것을 모른다.
 */
function signOf(value: DialValue): string {
  return typeof value === "number" && value > 0 ? "+" : "";
}
