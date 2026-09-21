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
    <SettingsRow description={describeDial(dialId, t)} label={label}>
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
            aria-label={t("settings.appearance.dialRevert")}
            className="icon-btn settings-dial-revert"
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
 * 행 설명 — 값이 빠진 로케일별 상수 문장. `settings.editor.maxWidth.desc` /
 * `settings.appearance.editorPadding.desc`는 더 이상 `{value}` 자리표시자를
 * 신지 않는다(§366 후속 수정) — 값은 `formatDialValue`가 따로 반환한다.
 */
function describeDial(dialId: DialId, t: Translate): string {
  switch (dialId) {
    case "editorMaxWidth":
      return t("settings.editor.maxWidth.desc");
    case "editorPadding":
      return t("settings.appearance.editorPadding.desc");
  }
}

/**
 * 값 읽기 문구 — 단위(px/rem)와 "제한 없음" 표기가 다이얼마다 다르다.
 * 다이얼이 둘뿐이라 분기로 충분하다 — `dials.ts` 머리말과 같은 이유로, 쓰지
 * 않을 일반성을 다이얼 정의 쪽에 미리 만들지 않는다.
 */
function formatDialValue(dialId: DialId, value: number, t: Translate): string {
  switch (dialId) {
    case "editorMaxWidth":
      return value === 0 ? t("settings.editor.maxWidth.noLimit") : `${value}px`;
    case "editorPadding":
      return `${value}rem`;
  }
}
