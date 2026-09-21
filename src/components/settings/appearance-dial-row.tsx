// §366 다이얼 한 줄. 출처 배지와 되돌리기가 여기 사는 이유는, 그 둘이 병합
// 결과의 부산물이라 값과 같은 자리에서 읽어야 어긋나지 않기 때문이다.

import type { DialId } from "../../appearance/dials";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";

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
    <div className="flex-header">
      <label htmlFor={`dial-${dialId}`}>{label}</label>
      <input
        id={`dial-${dialId}`}
        max={dial.range.max}
        min={dial.range.min}
        onChange={(e) =>
          useSettingsStore.getState().setDial(dialId, Number(e.target.value))
        }
        step={dial.range.step}
        type="range"
        value={resolved.value}
      />
      {/* 배지 텍스트 자체는 원시 origin("default"/"theme"/"user")이다 — 병합
          결과를 그대로 드러내는 값이라 로케일을 타면 안 된다. 사람이 읽는
          설명은 title 툴팁으로만 붙는다. */}
      <span
        data-testid="dial-origin"
        title={t(`settings.appearance.dialOrigin.${resolved.origin}`)}
      >
        {resolved.origin}
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
    </div>
  );
}
