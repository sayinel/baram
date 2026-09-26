// §366 출처 배지와 되돌리기 칸 — 다이얼 행(`appearance-dial-row.tsx`)과, 입력이 슬라이더도
// select 도 아닌 다이얼의 행(에디터 탭의 서체 행 · 본문 폭 행)이 함께 쓴다(스펙 0060 §7.1).
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

import type { DialId } from "../../appearance/dials";

import { RotateCcw } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { resolveDials } from "../../appearance/merge";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";

export function DialOriginSlot({ dialId }: { dialId: DialId }) {
  const { t } = useTranslation();
  const { appearanceOverrides } = useSettingsStore(
    useShallow((s) => ({ appearanceOverrides: s.appearanceOverrides })),
  );
  const themeDials = useThemeDials();
  const resolved = resolveDials(themeDials, appearanceOverrides)[dialId];
  // "이 행이 사용자 층 없이는 무엇을 보여 줄까" — 되돌리기 라벨이 테마로
  // 가는지 기본값으로 가는지는 이 질문 하나로 정해진다. 이름을 한 번 붙여
  // 그 질문을 한 곳에서만 말한다.
  const revertedToNonUserLayer = resolveDials(themeDials, {})[dialId];
  const revertLabel =
    revertedToNonUserLayer.origin === "theme"
      ? t("settings.appearance.dialRevertToTheme")
      : t("settings.appearance.dialRevert");

  return (
    // 고정 폭 슬롯(`.settings-dial-origin`, modal.css) 하나로 배지와
    // 되돌리기 버튼을 함께 묶는다 — 슬라이더는 `settings-row-control`
    // 안에서 오른쪽 정렬이라, 슬롯 폭이 origin마다 바뀌면(문구 길이·
    // 버튼 유무 차이) 슬라이더 위치도 함께 밀린다. `data-origin`은 병합
    // 결과의 원시 origin — 로케일과 무관한 시험용 걸쇠다. 슬롯 자체(배지가
    // 아니라)에 다는 이유는, default에서는 배지가 아예 렌더되지 않아서다
    // — 걸쇠가 배지에 있으면 "이 행이 default다"를 확인할 자리가 사라진다.
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
  );
}
