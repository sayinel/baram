// §364 v26 → v27 마이그레이션. `editorMaxWidth` 가 독립 설정에서 외관 다이얼로
// 옮겨가면서, 기존 저장분의 값을 사용자 층(`appearanceOverrides`)으로 옮긴다.
//
// ‼️ 아래 `FROM` 은 26 으로 고정한다 — 이 마이그레이션이 `version < 27` 게이트에
// 있기 때문이다(store.ts 실측). `theme-modes-migration.test.ts` 가 기록한 교훈과
// 같다: `useSettingsStore.persist.getOptions().version! - 1` 처럼 현재 버전에서
// 파생하면, 다음 마이그레이션이 버전을 또 올릴 때 파생값이 밀려 이 게이트를
// 건너뛴다. 고정값 26 은 이후 몇 번을 올려도 여전히 `version < 27` 게이트를
// 건드린다.
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

const FROM = 26;

function migrate(state: Record<string, unknown>): Record<string, unknown> {
  const fn = useSettingsStore.persist.getOptions().migrate!;
  return fn(state, FROM) as Record<string, unknown>;
}

describe("editorMaxWidth → appearanceOverrides 마이그레이션", () => {
  it("기본값(800)을 쓰던 사용자는 키를 얻지 않는다 — §364.2 희소성 불변식", () => {
    // 무엇이 이것을 실패시키는가: 전부 옮기면 appearanceOverrides 가 채워져
    // `system` 테마의 OS 추종이 인라인 변수에 눌려 죽는다. 이 케이스가
    // 마이그레이션 층에서 그 불변식이 깨질 수 있는 유일한 자리다.
    const out = migrate({ editorMaxWidth: 800 });
    expect(out.appearanceOverrides).toBeUndefined();
  });

  it("800 이 아닌 값(1200)을 쓰던 사용자는 사용자 층으로 옮겨진다", () => {
    const out = migrate({ editorMaxWidth: 1200 });
    expect(out.appearanceOverrides).toEqual({ editorMaxWidth: 1200 });
  });

  it("0(무제한)을 쓰던 사용자는 없었던 것이 아니라 0 그대로 옮겨진다", () => {
    // 무엇이 이것을 실패시키는가: `legacy` 를 falsy 로 판정하면(`if (legacy)`)
    // 0 이 "값 없음"과 같은 취급을 받아 이 사용자만 조용히 기본값(800)으로
    // 되돌아간다 — 정확히 "무제한"을 의도한 사람이 가장 먼저 걸린다.
    const out = migrate({ editorMaxWidth: 0 });
    expect(out.appearanceOverrides).toEqual({ editorMaxWidth: 0 });
  });

  it("editorMaxWidth 키 자체가 없던(v5 이전) 설치는 손대지 않는다", () => {
    const out = migrate({ tabSize: 4 });
    expect(out.appearanceOverrides).toBeUndefined();
    expect(out.tabSize).toBe(4);
  });

  // 게이트가 없으면, 업그레이드 뒤 사용자가 appearanceOverrides 를 직접 비운
  // 것이 다음 버전 올림에서 legacy 값으로 다시 채워질 수 있다.
  it("does not fire again for a version at or past the gate", () => {
    const current = useSettingsStore.persist.getOptions().version ?? 0;
    const fn = useSettingsStore.persist.getOptions().migrate!;
    const out = fn(
      { editorMaxWidth: 1200, appearanceOverrides: {} },
      current,
    ) as Record<string, unknown>;
    expect(out.appearanceOverrides).toEqual({});
  });
});
