// 토큰 감사 순서 3 — 기본 테마 팔레트와 DTCG 소스의 parity 핀.
//
// default-light/default-dark의 editable 25색은 tokens/semantic/*.json이 정의하는
// 값의 **수기 복사본**이다(테마 에디터의 출발점이 되기 때문에 존재한다). 복사본은
// 표류한다 — 이 핀을 넣는 시점에 이미 다섯 슬롯이 어긋나 있었다: warning·success가
// 라이트/다크 모두 옛 팔레트(#eab308/#22c55e)에 머물렀고, 다크 accent-subtle이
// blue.950(#172554) 대신 손으로 고른 #1e3a5f였다. 기본 테마 자체는 cascade가
// 그리므로 화면에는 안 보였지만, "Customize"를 누른 사용자는 잘못된 값에서
// 출발했다.
//
// 이 테스트는 DTCG JSON을 직접 읽고 primitive 참조를 해석해 25키 전부를 비교한다 —
// 특정 슬롯이 아니라 전체를 대조하므로, 앞으로 어떤 키가 표류해도 여기서 잡힌다.
// 장기적으로는 팔레트를 토큰 빌드가 생성하는 것이 정답이고(감사 순서 6), 그때
// 이 핀은 생성물 검증으로 역할이 바뀐다.
//
// ─── 역할 전환 (§355) ────────────────────────────────────────────────────────
// 위 기록의 결론대로 팔레트는 이제 tokens:build 생성물이다(감사 순서 6 완료).
// DTCG를 직접 해석하던 코드는 생성기와 같은 일을 두 번 하는 것이므로 지웠다.
// 남은 임무는 하나: 두 기본 테마가 정말로 생성물을 쓰는가.
import { describe, expect, it } from "vitest";

import { DEFAULT_DARK_PALETTE } from "../generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../generated/palette-light";
import { BUILT_IN_THEMES } from "../theme";

describe("기본 테마는 생성 팔레트를 그대로 쓴다", () => {
  it.each([
    ["default-light", DEFAULT_LIGHT_PALETTE],
    ["default-dark", DEFAULT_DARK_PALETTE],
  ])("%s 는 생성 상수와 동일 참조다", (id, generated) => {
    const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
    // toBe — 값 동등이 아니라 **같은 객체**. 손으로 베껴 적으면 값은 같아도 여기서 죽는다.
    expect(theme.colors).toBe(generated);
  });

  it("나머지 여섯 내장 테마는 리터럴로 남아 있다", () => {
    const generatedIds = new Set(["default-dark", "default-light"]);
    const literals = BUILT_IN_THEMES.filter((t) => !generatedIds.has(t.id));
    expect(literals).toHaveLength(6);
    for (const theme of literals) {
      expect(theme.colors).not.toBe(DEFAULT_LIGHT_PALETTE);
      expect(theme.colors).not.toBe(DEFAULT_DARK_PALETTE);
    }
  });
});
