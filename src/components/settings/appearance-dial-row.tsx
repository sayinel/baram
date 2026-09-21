// §366 다이얼 한 줄. 출처 배지와 되돌리기가 여기 사는 이유는, 그 둘이 병합
// 결과의 부산물이라 값과 같은 자리에서 읽어야 어긋나지 않기 때문이다.
//
// ‼️ `settings.appearance.dialRevert`("기본값으로 되돌리기")는 테마 층이 비어
// 있는 지금만 정확하다. `resetDial`은 사용자 층 키를 지울 뿐이므로, 0096
// (§371)이 테마 층에 실제 값을 실으면 되돌리기의 실제 의미는 "테마 값으로
// 되돌리기"가 된다 — 그때 이 라벨도 같이 바뀌어야 하고, 이 파일이 그 자리다.

import type { DialId } from "../../appearance/dials";
import type { Translate } from "../../i18n/useTranslation";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
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
  const dial = DIALS.find((d) => d.id === dialId);
  if (!dial) return null;

  const resolved = resolveDials({}, appearanceOverrides)[dialId];

  return (
    <SettingsRow
      description={describeValue(dialId, resolved.value, t)}
      label={label}
    >
      <input
        className="settings-range"
        max={dial.range.max}
        min={dial.range.min}
        onChange={(e) =>
          useSettingsStore.getState().setDial(dialId, Number(e.target.value))
        }
        step={dial.range.step}
        type="range"
        value={resolved.value}
      />
      {/* 고정 폭 슬롯(`.settings-dial-origin`, modal.css) 하나로 배지와
          되돌리기 버튼을 함께 묶는다 — 슬라이더는 `settings-row-control`
          안에서 오른쪽 정렬이라, 슬롯 폭이 origin마다 바뀌면(문구 길이·
          버튼 유무 차이) 슬라이더 위치도 함께 밀린다. */}
      <span className="settings-dial-origin">
        {/* `data-origin`은 병합 결과의 원시 origin — 로케일과 무관한 시험용
            걸쇠다. 사람이 읽는 텍스트는 로케일을 탄다(§366 스펙: 출처 배지는
            사용자에게 보이는 문구여야 한다 — title 툴팁으로만 두면 화면에는
            여전히 미번역 영단어가 남는다). */}
        <span
          className="settings-dial-origin-badge"
          data-origin={resolved.origin}
          data-testid="dial-origin"
        >
          {t(`settings.appearance.dialOrigin.${resolved.origin}`)}
        </span>
        {resolved.origin === "user" ? (
          <button
            className="btn-unstyled"
            data-testid="dial-revert"
            onClick={() => useSettingsStore.getState().resetDial(dialId)}
            title={t("settings.appearance.dialRevert")}
            type="button"
          >
            ↺
          </button>
        ) : null}
      </span>
    </SettingsRow>
  );
}

/**
 * 값 읽기 문구 — 단위(px/rem)와 "제한 없음" 표기가 다이얼마다 다르다.
 * 다이얼이 둘뿐이라 분기로 충분하다 — `dials.ts` 머리말과 같은 이유로, 쓰지
 * 않을 일반성을 다이얼 정의 쪽에 미리 만들지 않는다.
 */
function describeValue(dialId: DialId, value: number, t: Translate): string {
  switch (dialId) {
    case "editorMaxWidth": {
      const formatted =
        value === 0 ? t("settings.editor.maxWidth.noLimit") : `${value}px`;
      return t("settings.editor.maxWidth.desc", { value: formatted });
    }
    case "editorPadding":
      return t("settings.appearance.editorPadding.desc", {
        value: `${value}rem`,
      });
  }
}
