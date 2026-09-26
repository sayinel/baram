// §365 다이얼 8 — 본문 폭 행(스펙 0060 §8). 저장값은 px(`editorMaxWidth`) 하나이고, 이 행은
// 그것을 글자 수와 px 두 표현으로 보이고 움직인다(0055 §7.3 "저장 값은 하나이고 표현이 둘").
// 글자 수는 병합된 본문 서체로 잰 한 글자의 폭에서 환산한다(`appearance/line-measure.ts`).

import type { MeasureInput } from "../../appearance/line-measure";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import {
  CHARS_RANGE,
  charsForWidth,
  widthForChars,
} from "../../appearance/line-measure";
import { resolveDials } from "../../appearance/merge";
import { useAdvanceRatio } from "../../hooks/use-advance-ratio";
import { useEditorTypography } from "../../hooks/use-editor-typography";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { DialOriginSlot } from "./dial-origin-slot";
import { SettingsRow } from "./settings-shared";

/** 자 슬라이더에서 "제한 없음" 인 자리 — 최소 글자 수 바로 아래(계획 0107 P8). 저장되지 않는다. */
const NO_LIMIT_POSITION = CHARS_RANGE.min - 1;

/** `editorMaxWidth` 의 범위 — 다이얼 정의에서 읽는다(범위를 두 번 적지 않게). */
const WIDTH_DIAL = DIALS.find((d) => d.id === "editorMaxWidth");
const WIDTH_RANGE = WIDTH_DIAL?.kind === "number" ? WIDTH_DIAL.range : null;

export function EditorWidthRow() {
  const { locale, t } = useTranslation();
  const { appearanceOverrides, editorWidthUnit } = useSettingsStore(
    useShallow((s) => ({
      appearanceOverrides: s.appearanceOverrides,
      editorWidthUnit: s.editorWidthUnit,
    })),
  );
  const themeDials = useThemeDials();
  const { fontFamily, fontSize } = useEditorTypography();
  const ratio = useAdvanceRatio(fontFamily, locale);
  if (WIDTH_RANGE === null) return null;

  const dials = resolveDials(themeDials, appearanceOverrides);
  const width = numberOr(dials.editorMaxWidth.value, 0);
  const input: MeasureInput | null =
    ratio === null
      ? null
      : {
          advanceRatio: ratio,
          fontSizePx: fontSize,
          letterSpacingEm: numberOr(dials.editorLetterSpacing.value, 0),
          paddingPx: numberOr(dials.editorPadding.value, 0) * rootFontSizePx(),
        };
  // 폭을 아직 재지 못했으면 글자 수 표현을 쓸 수 없다 — px 로 보이고 단위 전환을 잠근다
  // (스펙 0060 §8.3: 잘못 잰 폭으로 px 를 쓰지 않게).
  const unit = input === null ? "px" : editorWidthUnit;
  const setWidth = (px: number) => {
    useSettingsStore.getState().setDial("editorMaxWidth", px);
  };

  const control =
    unit === "chars" && input !== null ? (
      <input
        className="settings-range"
        max={CHARS_RANGE.max}
        min={NO_LIMIT_POSITION}
        onChange={(e) => {
          const chars = Number(e.target.value);
          setWidth(
            chars === NO_LIMIT_POSITION
              ? 0
              : widthForChars(chars, input, WIDTH_RANGE.max),
          );
        }}
        step={CHARS_RANGE.step}
        type="range"
        value={
          width === 0
            ? NO_LIMIT_POSITION
            : clamp(
                charsForWidth(width, input),
                CHARS_RANGE.min,
                CHARS_RANGE.max,
              )
        }
      />
    ) : (
      <input
        className="settings-range"
        max={WIDTH_RANGE.max}
        min={WIDTH_RANGE.min}
        onChange={(e) => setWidth(Number(e.target.value))}
        step={WIDTH_RANGE.step}
        type="range"
        value={width}
      />
    );

  // 값 칸은 슬라이더 범위를 넘는 글자 수(예: 4000px)도 실제 값으로 보인다 — 슬라이더만 끝에 선다.
  const readout =
    width === 0
      ? t("settings.editor.maxWidth.noLimit")
      : unit === "chars" && input !== null
        ? t("settings.editor.maxWidth.chars", {
            value: String(charsForWidth(width, input)),
          })
        : `${width}px`;

  return (
    <SettingsRow
      description={t("settings.editor.maxWidth.desc")}
      label={t("settings.editor.maxWidth")}
    >
      {/* 계획 0107 P7 — 단위 전환은 이 모달의 다른 select 와 같은 `.settings-select` 다. */}
      <select
        aria-label={t("settings.editor.maxWidth.unit")}
        className="settings-select"
        disabled={input === null}
        onChange={(e) =>
          useSettingsStore
            .getState()
            .setEditorWidthUnit(e.target.value === "px" ? "px" : "chars")
        }
        value={unit}
      >
        <option value="chars">{t("settings.editor.maxWidth.unitChars")}</option>
        <option value="px">{t("settings.editor.maxWidth.unitPx")}</option>
      </select>
      {control}
      <span className="settings-dial-value" data-testid="dial-value">
        {readout}
      </span>
      <DialOriginSlot dialId="editorMaxWidth" />
    </SettingsRow>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 병합값은 그 다이얼의 parse 를 지났다 — 숫자가 아닌 갈래는 구조상 오지 않는다. */
function numberOr(value: number | string, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * rem → px. 앱 CSS 에는 루트 글자 크기 규칙이 없어 오늘 16px 이지만(0101 실측), 테마 CSS 까지 닫힌
 * 주장이 아니라서 계산된 값을 읽는다. 계산값을 내지 못하는 환경(jsdom 등)에서는 16 으로 떨어진다.
 */
function rootFontSizePx(): number {
  const px = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(px) && px > 0 ? px : 16;
}
