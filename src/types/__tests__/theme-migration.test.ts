// 토큰 감사 순서 9 꼬리 — migrateThemeColors의 승자 결정 핀.
//
// 옛 키(--color-accent)와 그것이 이주해 갈 canonical 키(--color-accent-default)를
// 한 객체가 동시에 들 수 있다 — 이주를 이미 거친 테마 JSON을 옛 도구가 다시
// 내보냈거나, 사용자가 손으로 합친 경우. 수정 전에는 Object.entries 순회 순서가
// 승자를 정했다: 옛 키가 뒤에 오면 stale 값이 canonical 값을 덮었다. 정체가
// 순서를 이겨야 한다 — canonical 키가 있으면 옛 키는 무시된다.
import { describe, expect, it } from "vitest";

import { defaultColorsForBase, migrateThemeColors } from "../theme";

describe("migrateThemeColors 승자 결정", () => {
  it("옛 키가 canonical 키 뒤에 와도 canonical 값이 이긴다", () => {
    const both = {
      "--color-accent-default": "#111111", // canonical — 이 값이 살아야 한다
      "--color-accent": "#999999", // 옛 키가 나중 순서로 덮치는 배치
    };
    expect(migrateThemeColors(both)["--color-accent-default"]).toBe("#111111");
  });

  it("canonical 키가 없으면 옛 키 값이 이주한다", () => {
    const oldOnly = { "--color-accent": "#222222" };
    expect(migrateThemeColors(oldOnly)["--color-accent-default"]).toBe(
      "#222222",
    );
  });

  // 적대 리뷰 2라운드: 존재만 보는 canonical 가드는 invalid canonical(빈
  // 문자열 등)이 유효한 옛 값을 무조건 버리게 했다 — 두 배치 순서 모두에서
  // 유효한 옛 값이 이겨야 순서 의존이 정말 사라진 것이다.
  it("canonical 값이 invalid면 유효한 옛 값이 이긴다 (양쪽 순서)", () => {
    const canonicalFirst = {
      "--color-accent-default": "",
      "--color-accent": "#123456",
    };
    const legacyFirst = {
      "--color-accent": "#123456",
      "--color-accent-default": "",
    };
    expect(migrateThemeColors(canonicalFirst)["--color-accent-default"]).toBe(
      "#123456",
    );
    expect(migrateThemeColors(legacyFirst)["--color-accent-default"]).toBe(
      "#123456",
    );
  });
});

describe("migrateThemeColors 누락 키 채움", () => {
  it("다크 fallback을 넘기면 누락 키가 다크 값으로 채워진다", () => {
    // 적대 리뷰: fallback을 생략한 호출자는 전부 Default Light를 받아, 키가
    // 모자란 다크 테마가 라이트 값(#ffffff 등)과 섞인 혼합 팔레트가 됐다.
    const dark = defaultColorsForBase("dark");
    const filled = migrateThemeColors({}, dark);
    expect(filled["--color-bg-input"]).toBe(dark["--color-bg-input"]);
    expect(filled["--color-bg-input"]).not.toBe(
      defaultColorsForBase("light")["--color-bg-input"],
    );
  });
});
