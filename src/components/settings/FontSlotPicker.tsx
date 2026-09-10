// §351 설정 행의 서체 슬롯 — 값 · 출처 배지 · 미리보기 스트립 · 브라우저 열기.
//
// 배지가 이 컴포넌트의 존재 이유다. §346까지 드롭다운은 없는 서체를 폴백으로
// 그려서 무효한 항목을 정상처럼 보이게 했다. 스트립은 여전히 폴백으로 렌더되지만
// 배지가 사실을 말한다.
import type { SystemFont } from "../../ipc/types";
import type { FontAvailability } from "../../utils/font/font-availability";

import { useTranslation } from "../../i18n/useTranslation";
import {
  BASE_EDITOR_STACK,
  BASE_MONO_STACK,
} from "../../utils/editor/font-surfaces";
import { quoteFamily } from "../../utils/editor/quote-font-family";
import { fontAvailability } from "../../utils/font/font-availability";
import {
  SAMPLE_CODE,
  SAMPLE_EN,
  SAMPLE_GLYPHS,
  SAMPLE_KO,
} from "../../utils/font/font-sample-text";

export type FontSlot = "body" | "code";

const BADGE_KEY: Record<FontAvailability, string> = {
  bundled: "settings.editor.fontPicker.bundled",
  missing: "settings.editor.fontPicker.missing",
  system: "settings.editor.fontPicker.system",
};

/** 배지 색 클래스 — availability 를 문자열로 이어붙이지 않는다: 그러면 클래스
 *  이름 조각이 서체 이름처럼 보이는 리터럴이 되어 i18n 프로즈 스캐너가 걸린다. */
const BADGE_CLASS: Record<FontAvailability, string> = {
  bundled: "settings-font-badge-bundled",
  missing: "settings-font-badge-missing",
  system: "settings-font-badge-system",
};

interface Props {
  fonts: SystemFont[];
  onChange: (family: string) => void;
  onOpenBrowser: (slot: FontSlot) => void;
  slot: FontSlot;
  value: string;
}

export function FontSlotPicker({ fonts, onOpenBrowser, slot, value }: Props) {
  const { t } = useTranslation();
  const availability = fontAvailability(value, fonts);
  const korean = fonts.find(
    (f) => f.name.toLowerCase() === value.trim().toLowerCase(),
  )?.hasKorean;
  const badgeKey =
    availability === "system" && korean
      ? "settings.editor.fontPicker.systemKorean"
      : BADGE_KEY[availability];
  const stack = slot === "code" ? BASE_MONO_STACK : BASE_EDITOR_STACK;
  const previewFamily =
    value.trim() === "" ? stack : `${quoteFamily(value)}, ${stack}`;

  return (
    <div className="settings-font-slot flex-col">
      <div className="settings-font-value">
        <span
          className="settings-font-value-name text-truncate"
          style={{ fontFamily: previewFamily }}
        >
          {value.trim() === ""
            ? t("settings.editor.fontPicker.systemDefault")
            : value}
        </span>
        <span className={`settings-font-badge ${BADGE_CLASS[availability]}`}>
          {t(badgeKey)}
        </span>
        <button
          className="settings-font-more btn-unstyled"
          onClick={() => onOpenBrowser(slot)}
          type="button"
        >
          {t("settings.editor.fontPicker.more")}
        </button>
      </div>
      <div
        className="settings-font-strip"
        data-testid="font-preview-strip"
        style={{ fontFamily: previewFamily }}
      >
        <div className="settings-font-strip-primary text-truncate">
          {slot === "code" ? SAMPLE_CODE : SAMPLE_KO}
        </div>
        <div className="settings-font-strip-secondary text-truncate">
          {SAMPLE_EN}
        </div>
        <div
          className="settings-font-strip-glyphs text-truncate"
          data-testid="font-preview-glyphs"
        >
          {SAMPLE_GLYPHS}
        </div>
      </div>
    </div>
  );
}
