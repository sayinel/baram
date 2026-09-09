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

  it("backfills v14-era state with the NEW value, not the old literal", () => {
    // ‼️ v14 백필(store.ts)이 옛 리터럴을 다시 심으면 리터럴이 두 곳에 남는다
    const result = migrate({}, 13) as {
      zettelkastenStartupBehavior?: string;
    };
    expect(result.zettelkastenStartupBehavior).toBe("openHomeNote");
  });

  it("bumps the store version to 24 exactly once", () => {
    expect(useSettingsStore.persist.getOptions().version).toBe(24);
  });

  it("defaults a fresh install to openHomeNote", () => {
    expect(useSettingsStore.getInitialState().zettelkastenStartupBehavior).toBe(
      "openHomeNote",
    );
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
