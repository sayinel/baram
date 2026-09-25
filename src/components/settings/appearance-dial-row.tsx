// §366 다이얼 한 줄. 출처 배지와 되돌리기가 여기 사는 이유는, 그 둘이 병합
// 결과의 부산물이라 값과 같은 자리에서 읽어야 어긋나지 않기 때문이다.
//
// ‼️ 되돌리기 라벨은 층을 따라간다. `resetDial`은 사용자 층 키를 **지울** 뿐이므로,
// 그 다이얼에 대해 테마가 말을 했으면 되돌아가는 자리는 기본값이 아니라 테마 값이다
// — §371이 매니페스트에 `dials`를 실으면서 그 상태가 실제로 생겼고(이 주석의 앞
// 판본은 그것을 예고로 적어 두었다), 그래서 라벨이 둘로 갈린다.
//
// 어느 쪽인지는 `resolveDials(themeDials, {})`에게 묻는다 — 사용자 층을 뺀 병합
// 결과가 곧 되돌린 **뒤의** 상태이므로, 라벨이 같은 화면의 배지와 어긋날 방법이
// 구조적으로 없다. `themeDials[dialId] !== undefined`로 판정하면 테마가 말했지만
// `parse`에 걸린 값(앱이 범위를 좁힌 뒤에 남은 낡은 매니페스트)에서 둘이 갈린다:
// 라벨은 "테마 값으로"라고 하고 실제 결과는 기본값이 된다.

import type { DialId, DialValue } from "../../appearance/dials";
import type { Translate } from "../../i18n/useTranslation";

import { RotateCcw } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { dialOptionLabelKey } from "./dial-option-label";
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

  const resolved = resolveDials(themeDials, appearanceOverrides)[dialId];
  // "이 행이 사용자 층 없이는 무엇을 보여 줄까" — 되돌리기 라벨이 테마로
  // 가는지 기본값으로 가는지는 이 질문 하나로 정해진다. 이름을 한 번 붙여
  // 그 질문을 한 곳에서만 말한다.
  const revertedToNonUserLayer = resolveDials(themeDials, {})[dialId];
  const revertLabel =
    revertedToNonUserLayer.origin === "theme"
      ? t("settings.appearance.dialRevertToTheme")
      : t("settings.appearance.dialRevert");

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
      {/* 고정 폭 슬롯(`.settings-dial-origin`, modal.css) 하나로 배지와
          되돌리기 버튼을 함께 묶는다 — 슬라이더는 `settings-row-control`
          안에서 오른쪽 정렬이라, 슬롯 폭이 origin마다 바뀌면(문구 길이·
          버튼 유무 차이) 슬라이더 위치도 함께 밀린다. `data-origin`은 병합
          결과의 원시 origin — 로케일과 무관한 시험용 걸쇠다. 슬롯 자체(배지가
          아니라)에 다는 이유는, default에서는 배지가 아예 렌더되지 않아서다
          — 걸쇠가 배지에 있으면 "이 행이 default다"를 확인할 자리가 사라진다. */}
      <span
        className="settings-dial-origin"
        data-origin={resolved.origin}
        data-testid="dial-origin"
      >
        {/* default는 배지를 아예 렌더하지 않는다 — 값은 이미 위 description에
            있으므로 "기본값" 배지는 "아무 일도 없었다"는 뜻뿐이고, 앞으로 늘
            다이얼(0094)마다 그 무의미한 배지가 한 줄씩 쌓인다. 사람이 읽는
            텍스트는 로케일을 탄다(§366 스펙: title 툴팁만으로는 화면에 여전히
            미번역 영단어가 남는다). */}
        {resolved.origin === "default" ? null : (
          <span
            className="settings-dial-origin-badge"
            data-testid="dial-origin-badge"
          >
            {t(`settings.appearance.dialOrigin.${resolved.origin}`)}
          </span>
        )}
        {resolved.origin === "user" ? (
          // `icon-btn`(base.css)이 중앙 정렬·cursor를 맡고, `settings-dial-revert`
          // (modal.css)가 크기·색·hover를 맡는다 — `.settings-close`/
          // `.settings-search-clear`와 같은 아이콘 버튼 관용구다. `btn-unstyled`는
          // 여기서 쓰지 않는다: 그 클래스의 목적 자체가 버튼을 텍스트처럼 벗기는
          // 것이라, 버튼처럼 보이게 만들고 싶은 이 자리와는 반대다.
          <button
            aria-label={revertLabel}
            className="icon-btn settings-dial-revert"
            data-testid="dial-revert"
            onClick={() => useSettingsStore.getState().resetDial(dialId)}
            title={revertLabel}
            type="button"
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
      </span>
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
    case "cornerRadius":
      return t("settings.appearance.cornerRadius.desc");
    case "density":
      return t("settings.appearance.density.desc");
    case "editorEmphasisStyle":
      return t("settings.editor.editorEmphasisStyle.desc");
    case "editorLetterSpacing":
      return t("settings.editor.editorLetterSpacing.desc");
    case "editorLineBreak":
      return t("settings.editor.editorLineBreak.desc");
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
    case "cornerRadius":
    case "density":
      return "";
    case "editorEmphasisStyle":
      // editorLineBreak와 같은 이유로 빈 문자열이다 — 열거의 값 readout은
      // select 자체가 이미 보여 준다.
      return "";
    case "editorLetterSpacing":
      return `${rounded}em`;
    case "editorLineBreak":
      return "";
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
