// §365 · §368 — enum 다이얼의 옵션 라벨 키가 카탈로그에 있고, 행과 검색이 같은
// 키를 쓴다(스펙 0055 §4.4 · 0057 §6).
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DIALS } from "../../../appearance/dials";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { AppearanceDialRow } from "../appearance-dial-row";
import { dialOptionLabelKey } from "../dial-option-label";
import { useSettingsRegistry } from "../settings-registry";

const enumDials = DIALS.filter((d) => d.kind === "enum");

describe("enum 다이얼 옵션 라벨", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      activeThemeId: "system",
      appearanceOverrides: {},
      installedThemes: {},
      locale: "en",
    });
  });

  // 무엇이 이것을 실패시키는가: 네임스페이스가 틀리면(외관 탭 다이얼이
  // `settings.editor.density.compact` 를 읽으면) 카탈로그에 그 키가 없다.
  // 비공허성: 아래 목록은 `DIALS` 의 enum 다이얼 일곱 전부다(에디터 셋 + §365 밀도·모서리
  // 둘 + 배경 대비 둘). 하나라도 필터에서 빠지면 루프가 그만큼 덜 돈다.
  it("모든 옵션의 라벨 키가 en·ko 에 있다", () => {
    expect(enumDials.map((d) => d.id)).toEqual(
      expect.arrayContaining([
        "editorLineBreak",
        "editorOrderedMarkerAlign",
        "editorEmphasisStyle",
        "density",
        "cornerRadius",
        "backgroundContrastLight",
        "backgroundContrastDark",
      ]),
    );
    for (const dial of enumDials) {
      for (const option of dial.options) {
        const key = dialOptionLabelKey(dial.id, option);
        expect(en, key).toHaveProperty([key]);
        expect(ko, key).toHaveProperty([key]);
      }
    }
  });

  // 무엇이 이것을 실패시키는가: 검색 항목이 옵션을 손으로 다시 나열하다 한쪽만
  // 고치면 — 검색으로 찾은 옵션의 이름과 행의 이름이 갈린다.
  it("검색 항목의 옵션은 DIALS 의 옵션 · 같은 라벨 키다", () => {
    const { result } = renderHook(() => useSettingsRegistry());
    for (const dial of enumDials) {
      const entry = result.current.find((s) => s.id === dial.id);
      expect(entry, dial.id).toBeDefined();
      expect(entry?.control.options).toEqual(
        dial.options.map((option) => ({
          label: dialOptionLabelKey(dial.id, option),
          value: option,
        })),
      );
    }
  });

  // 무엇이 이것을 실패시키는가: 행이 함수를 거치지 않고 키를 스스로 지으면
  // 위 두 테스트가 초록인 채로 행만 키 문자열을 그대로 보인다.
  it("행의 select 는 같은 라벨을 보인다", () => {
    render(<AppearanceDialRow dialId="density" label="Density" />);
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual([
      en["settings.appearance.density.compact"],
      en["settings.appearance.density.default"],
      en["settings.appearance.density.spacious"],
    ]);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "compact" },
    });
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({
      density: "compact",
    });
  });
});
