import type { ThemeSource } from "../theme-sources";

// 스펙 0049 §5.2 액션 세트 표를 코드로 고정한다. 컴포넌트가 개별 판단하지 않는다.
import { describe, expect, it } from "vitest";

import { themeActions } from "../theme-sources";

const TABLE: Record<ThemeSource, string[]> = {
  builtin: ["apply", "duplicate"],
  community: ["apply", "duplicate", "update", "remove", "consentHistory"],
  custom: ["apply", "duplicate", "export", "remove"],
  dev: ["apply", "export", "remove", "reload"],
};

describe("themeActions", () => {
  for (const [source, expected] of Object.entries(TABLE)) {
    it(`${source}: ${expected.join(" · ")}`, () => {
      const actions = themeActions(source as ThemeSource);
      const enabled = Object.entries(actions)
        .filter(([, on]) => on)
        .map(([name]) => name)
        .sort();
      expect(enabled).toEqual([...expected].sort());
    });
  }

  it("네 출처를 모두 다룬다", () => {
    const sources: ThemeSource[] = ["builtin", "community", "custom", "dev"];
    expect(Object.keys(TABLE).sort()).toEqual([...sources].sort());
  });
});
