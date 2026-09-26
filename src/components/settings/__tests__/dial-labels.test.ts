// §371 6a — 외관 내보내기의 요약이 다이얼을 설정 행과 같은 이름 · 같은 모양으로 부른다(스펙 0062 §4).
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DIALS } from "../../../appearance/dials";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { DIAL_LABEL_KEY, dialValueSummary } from "../dial-labels";
import { dialOptionLabelKey } from "../dial-option-label";
import { useSettingsRegistry } from "../settings-registry";
import { registryIdOf } from "./helpers/dial-registry-ids";

const tEn = (key: string, params?: Record<string, string>): string => {
  let text = (en as Record<string, string>)[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {}))
    text = text.replace(`{${k}}`, v);
  return text;
};

describe("DIAL_LABEL_KEY", () => {
  it("모든 다이얼의 라벨 키가 두 카탈로그에 있다", () => {
    for (const dial of DIALS) {
      expect(en, dial.id).toHaveProperty([DIAL_LABEL_KEY[dial.id]]);
      expect(ko, dial.id).toHaveProperty([DIAL_LABEL_KEY[dial.id]]);
    }
  });

  // 무엇이 이것을 실패시키는가: 요약과 설정 검색이 같은 다이얼을 다른 이름으로 부르면.
  it("설정 검색 항목의 라벨과 같은 키다", () => {
    const { result } = renderHook(() => useSettingsRegistry());
    const labelById = new Map(result.current.map((s) => [s.id, s.label]));
    for (const dial of DIALS) {
      expect(labelById.get(registryIdOf(dial.id)), dial.id).toBe(
        DIAL_LABEL_KEY[dial.id],
      );
    }
  });
});

describe("dialValueSummary", () => {
  it("열거는 옵션 라벨로", () => {
    expect(dialValueSummary("density", "compact", tEn)).toBe(
      tEn(dialOptionLabelKey("density", "compact")),
    );
  });

  it("빈 서체는 '시스템 기본'", () => {
    expect(dialValueSummary("editorFontFamily", "", tEn)).toBe(
      tEn("settings.editor.fontPicker.systemDefault"),
    );
  });

  it("서체 이름은 그대로, 숫자는 설정 행과 같은 단위로", () => {
    expect(dialValueSummary("editorFontFamily", "Inter", tEn)).toBe("Inter");
    expect(dialValueSummary("editorFontSize", 18, tEn)).toBe("18px");
    expect(dialValueSummary("editorMaxWidth", 0, tEn)).toBe(
      tEn("settings.editor.maxWidth.noLimit"),
    );
  });
});
