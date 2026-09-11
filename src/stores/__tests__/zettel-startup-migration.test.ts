// §344 settings store v23 -> v24: `zettelkastenStartupBehavior` 값 `"openInbox"`
// 는 표기 오류였다 — 실제로 여는 것은 홈 노트뿐이었다. 값과 라벨을 `openHomeNote`
// 로 개명하고, 기존 사용자를 위해 옛 값을 이어주는 마이그레이션을 검증한다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

function migrate(persisted: unknown, version: number): unknown {
  const { migrate: fn } = useSettingsStore.persist.getOptions();
  if (typeof fn !== "function") {
    throw new Error("persist migrate is not configured");
  }
  return fn(persisted, version);
}

describe("settings store v23 -> v24 (§344 openInbox -> openHomeNote)", () => {
  it("remaps a persisted openInbox to openHomeNote", () => {
    // 개명 마이그레이션이 없으면 새 비교식에서 탈락해 조용히 "아무것도 안 함"이 된다
    const result = migrate(
      { zettelkastenStartupBehavior: "openInbox" },
      23,
    ) as { zettelkastenStartupBehavior?: string };
    expect(result.zettelkastenStartupBehavior).toBe("openHomeNote");
  });

  it("leaves 'nothing' alone — non-vacuity control", () => {
    const result = migrate({ zettelkastenStartupBehavior: "nothing" }, 23) as {
      zettelkastenStartupBehavior?: string;
    };
    expect(result.zettelkastenStartupBehavior).toBe("nothing");
  });

  it("a v13-era install with nothing persisted ends up on openHomeNote through the whole chain", () => {
    // v14's backfill and v24's remap both fire inside this one migrate()
    // call, so this only proves the FINAL value is right — it does not
    // prove the v14 backfill itself writes the new literal. If v14 wrote
    // the old literal instead, v24 would silently fix it up right after in
    // the same call and this assertion would still pass. The v14 literal's
    // singularity is guarded by the scan test below, not by this one.
    const result = migrate({}, 13) as {
      zettelkastenStartupBehavior?: string;
    };
    expect(result.zettelkastenStartupBehavior).toBe("openHomeNote");
  });

  it("a v13-era install already persisted with openInbox also ends up on openHomeNote", () => {
    // Distinguishes from the case above: here the key IS already defined
    // on disk (a real, persistable v13-era value — this field is in the
    // partialize allowlist), so v14's `=== undefined` guard must SKIP
    // entirely and the conversion must come from the v24 remap alone.
    const result = migrate(
      { zettelkastenStartupBehavior: "openInbox" },
      13,
    ) as { zettelkastenStartupBehavior?: string };
    expect(result.zettelkastenStartupBehavior).toBe("openHomeNote");
  });

  it("a v13-era install that explicitly chose 'nothing' keeps it", () => {
    // ‼️ 이 케이스만이 v14 백필의 `=== undefined` 가드를 고정한다. 위의
    // "leaves 'nothing' alone" 은 버전 23 이라 v14 블록을 아예 건너뛴다.
    // 가드가 없으면 사용자가 명시적으로 고른 값이 조용히 덮어써진다.
    const result = migrate({ zettelkastenStartupBehavior: "nothing" }, 13) as {
      zettelkastenStartupBehavior?: string;
    };
    expect(result.zettelkastenStartupBehavior).toBe("nothing");
  });

  // 이 단정이 지키는 것은 "게이트가 도달 가능하다"이지 현재 버전이 아니다.
  // 등호로 적어 두면 다음 버전 올림마다 §344 와 무관한 이유로 빨간불이 되고,
  // 그때 고치는 사람은 이 파일이 무엇을 주장하려 했는지 알 수 없다. 버전이
  // 24 아래로 되돌아가면 v23 사용자에게 이 재매핑이 영원히 안 돈다 — 그것만 본다.
  it("is at a version that can still run the openHomeNote remap", () => {
    expect(
      useSettingsStore.persist.getOptions().version,
    ).toBeGreaterThanOrEqual(24);
  });

  it("defaults a fresh install to openHomeNote", () => {
    expect(useSettingsStore.getInitialState().zettelkastenStartupBehavior).toBe(
      "openHomeNote",
    );
  });
});

// §92 / Fix E (M-2, A4): the v13 -> v14 block backfills FOUR fields, each behind its
// own `=== undefined` guard — only `zettelkastenStartupBehavior`'s guard had a
// dedicated pin (the "explicitly chose 'nothing' keeps it" case above). The other
// three (`zettelkastenEnabled`, `zettelkastenDirectory`, `zettelkastenHomeNote`) had
// none, so a guard silently turned into an unconditional assignment for any of them
// would have clobbered a real v13-era value and nothing would have caught it.
describe("settings store v13 -> v14 (§92 Zettelkasten additive backfill)", () => {
  it("preserves all four explicitly-persisted v13 values, none replaced by their v14 default", () => {
    // Every value here is chosen to differ from its v14 default (enabled: false,
    // directory: "", startupBehavior: "openHomeNote", homeNote: "") — otherwise an
    // unconditional-assignment mutation of that field would coincidentally produce
    // the same result and the assertion would pass vacuously for it.
    const result = migrate(
      {
        zettelkastenDirectory: "/custom/zettel",
        zettelkastenEnabled: true,
        zettelkastenHomeNote: "home.md",
        zettelkastenStartupBehavior: "nothing",
      },
      13,
    ) as {
      zettelkastenDirectory?: string;
      zettelkastenEnabled?: boolean;
      zettelkastenHomeNote?: string;
      zettelkastenStartupBehavior?: string;
    };
    expect(result).toMatchObject({
      zettelkastenDirectory: "/custom/zettel",
      zettelkastenEnabled: true,
      zettelkastenHomeNote: "home.md",
      zettelkastenStartupBehavior: "nothing",
    });
  });
});

describe("the old literal survives in exactly one place (§344)", () => {
  /**
   * 이 스캔 테스트 자신은 제외한다 — 이 파일의 describe/it 이름과 주석은 옛 이름을
   * 반드시 입에 올려야 하므로(그게 이 파일의 주제다) 자기 자신을 세게 된다.
   * 예외는 이 한 파일뿐이고, 파일을 옮기면 이 경로가 안 맞아 **빨간불로** 드러난다
   * (조용히 통과하는 방향이 아니다).
   */
  const SELF = "src/stores/__tests__/zettel-startup-migration.test.ts";

  /** src/ 아래 모든 소스 파일에서 옛 리터럴 출현 수를 파일별로 센다. */
  function scanForOldLiteral(): Record<string, number> {
    const root = process.cwd();
    const out: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const abs = path.join(dir, entry);
        if (statSync(abs).isDirectory()) {
          walk(abs);
          continue;
        }
        if (!/\.(ts|tsx|json)$/.test(entry)) continue;
        const rel = path.posix.join(
          ...path.relative(root, abs).split(path.sep),
        );
        if (rel === SELF) continue;
        const n = [...readFileSync(abs, "utf8").matchAll(/openInbox/g)].length;
        if (n > 0) out[rel] = n;
      }
    };
    walk(path.join(root, "src"));
    return out;
  }

  it("SELF names a file that actually exists", () => {
    expect(existsSync(path.join(process.cwd(), SELF))).toBe(true);
  });

  it("appears only inside the v24 migration", () => {
    // store.ts 의 v24 블록 하나만 남는다
    expect(scanForOldLiteral()).toEqual({
      "src/stores/settings/store.ts": 1,
    });
  });
});
