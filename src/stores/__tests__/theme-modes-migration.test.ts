// §357 base → modes 마이그레이션. 저장된 커스텀 테마를 잃지 않는 것이 전부다.
//
// ‼️ 아래 `FROM` 은 25 로 고정한다 — 이 마이그레이션이 `version < 26` 게이트에
// 있기 때문이다(store.ts 실측). 원래 `useSettingsStore.persist.getOptions()
// .version! - 1` 로 파생시켰으나, 그 식은 "현재 버전 바로 아래"를 뜻하지 이
// 마이그레이션 직전 버전을 뜻하지 않는다 — §364 가 버전을 26→27 로 올리자 파생값이
// 26 이 되어 `version < 26` 게이트를 건너뛰었다(26 은 26 보다 작지 않다). 이
// 파일의 단정 넷이 그 자리에서 실패로 드러났으니 여기서는 조용하지 않았지만,
// 다음 마이그레이션이 추가될 때마다 같은 식으로 또 밀린다. 고정값은 이후 몇
// 번을 올려도 여전히 v26 게이트를 건드린다 — 25 는 항상 26 보다 작다.
import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { useSettingsStore } from "../settings/store";

const FROM = 25;

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
