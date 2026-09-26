// §361 · 스펙 0060 §4.1 — 입을 수 있는 테마 id 를 정하는 순수 함수. 훅(`useEffectiveThemeId`)과
// React 밖 읽기(`readEditorTypography`)가 같은 답을 내려고 여기 있다.
import type { RevocationSeverity } from "../../plugins/revocation";
import type { InstalledTheme } from "../theme-install";

import { describe, expect, it } from "vitest";

import { effectiveThemeIdOf } from "../theme-revocation";

function installed(): Record<string, InstalledTheme> {
  return {
    prose: {
      checksum: "c".repeat(64),
      consentedAt: "2026-09-01T00:00:00.000Z",
      consentedVersion: "1.0.0",
      id: "prose",
      installedAt: "2026-09-01T00:00:00.000Z",
      installPath: "/home/u/.baram/themes/prose",
      manifest: {
        author: "a",
        description: "d",
        engines: { baram: ">=0.7.0" },
        id: "prose",
        license: "MIT",
        modes: { light: { tokens: "t.json" } },
        name: "prose",
        version: "1.0.0",
      },
      modes: { light: { css: false } },
    },
  };
}

const revoked = (severity: RevocationSeverity) => ({
  revoked: [{ id: "prose", reason: "r", severity, versions: "*" as const }],
  sequence: 1,
  version: 1,
});

describe("effectiveThemeIdOf", () => {
  it("철회가 없으면 고른 테마 그대로", () => {
    expect(effectiveThemeIdOf("prose", installed(), null)).toEqual({
      effectiveThemeId: "prose",
      forceDeactivated: false,
    });
  });

  it("malicious 철회는 system 으로 벗긴다", () => {
    expect(
      effectiveThemeIdOf("prose", installed(), revoked("malicious")),
    ).toEqual({ effectiveThemeId: "system", forceDeactivated: true });
  });

  // 비공허성: 위 테스트가 "철회 목록에 이름이 있으면 무조건 벗긴다" 로도 통과하지 않게.
  it("unlisted 철회는 벗기지 않는다", () => {
    expect(
      effectiveThemeIdOf("prose", installed(), revoked("unlisted")),
    ).toEqual({ effectiveThemeId: "prose", forceDeactivated: false });
  });
});
