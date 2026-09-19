// §357 base → modes 마이그레이션. 저장된 커스텀 테마를 잃지 않는 것이 전부다.
//
// ‼️ 아래 `FROM` 은 이 마이그레이션 직전 버전이다. store.ts 의 `version:` 에서
// 파생시킨다 — 숫자를 여기 고정하면 다음 마이그레이션이 추가될 때 조용히
// 무의미해진다.
import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { useSettingsStore } from "../settings/store";

const FROM = useSettingsStore.persist.getOptions().version! - 1;

function migrate(state: Record<string, unknown>): Record<string, unknown> {
  const fn = useSettingsStore.persist.getOptions().migrate!;
  return fn(state, FROM) as Record<string, unknown>;
}

describe("base → modes 마이그레이션", () => {
  it("라이트 커스텀 테마가 modes.light 로 옮겨진다", () => {
    const colors = defaultColorsForBase("light");
    const out = migrate({
      customThemes: [
        { id: "c1", name: "Mine", base: "light", builtIn: false, colors },
      ],
    });
    expect(out.customThemes).toEqual([
      {
        id: "c1",
        name: "Mine",
        source: "custom",
        modes: { light: { colors } },
      },
    ]);
  });

  it("다크 커스텀 테마가 modes.dark 로 옮겨진다", () => {
    const colors = defaultColorsForBase("dark");
    const out = migrate({
      customThemes: [
        { id: "c2", name: "Night", base: "dark", builtIn: false, colors },
      ],
    });
    expect((out.customThemes as { modes: object }[])[0].modes).toEqual({
      dark: { colors },
    });
  });

  it("base 가 없거나 이상하면 light 로 둔다 — 테마를 버리지 않는다", () => {
    const colors = defaultColorsForBase("light");
    const out = migrate({
      customThemes: [{ id: "c3", name: "?", colors }],
    });
    expect((out.customThemes as { modes: object }[])[0].modes).toEqual({
      light: { colors },
    });
  });

  it("customThemes 가 배열이 아니면 빈 배열로 만든다", () => {
    expect(migrate({ customThemes: "corrupt" }).customThemes).toEqual([]);
  });

  it("이미 modes 를 가진 항목은 그대로 둔다 (재실행 안전)", () => {
    const entry = {
      id: "c4",
      name: "New",
      source: "custom",
      modes: { light: { colors: defaultColorsForBase("light") } },
    };
    expect(migrate({ customThemes: [entry] }).customThemes).toEqual([entry]);
  });
});
