// §367.3 설치 시점 대비 관문. **거부하지 않는다** — 저대비를 의도한 정당한 미학을
// 막지 않으면서, 사고로 읽을 수 없게 된 조합은 저자에게 알린다.
import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES, defaultColorsForBase } from "../../types/theme";
import { contrastWarningsFor } from "../contrast-report";

describe("contrastWarningsFor", () => {
  // 실측(2026-09-22, 이 브랜치 HEAD 04224ae5): 기본 다크 팔레트는 경고가 없다.
  // 기본 라이트 팔레트는 `text-secondary`/`bg-panel` 이 4.346 으로 AA(4.5) 를
  // 근소하게 밑돌아 **하나** 경고한다 — 이것이 계획 문서가 처음 적어 둔 "기본
  // 팔레트 둘 다 무경고" 라는 가정과 다르다는 것을 이 테스트가 고정한다: 관문은
  // 미학 판단일 뿐 여기서 팔레트를 고치는 것은 이 태스크의 범위가 아니다.
  it("기본 다크 팔레트는 경고하지 않고, 라이트는 실측 그대로 한 쌍을 경고한다", () => {
    expect(contrastWarningsFor("dark", defaultColorsForBase("dark"))).toEqual(
      [],
    );
    const lightWarnings = contrastWarningsFor(
      "light",
      defaultColorsForBase("light"),
    );
    expect(lightWarnings).toHaveLength(1);
    expect(lightWarnings[0]).toMatchObject({
      background: "--color-bg-panel",
      foreground: "--color-text-secondary",
      mode: "light",
    });
    expect(lightWarnings[0]!.ratio).toBeCloseTo(4.346, 2);
  });

  // 실측을 고정한다(2026-09-22, 이 브랜치 HEAD 04224ae5). 관문이 조용히
  // 엄격해지거나 느슨해지면 여기서 잡힌다.
  it("내장 8개 중 다섯이 경고한다", () => {
    const warned: string[] = [];
    for (const theme of BUILT_IN_THEMES) {
      for (const mode of ["light", "dark"] as const) {
        const colors = theme.modes[mode]?.colors;
        if (colors === undefined) continue;
        if (contrastWarningsFor(mode, colors).length > 0) warned.push(theme.id);
      }
    }
    expect([...new Set(warned)].sort()).toEqual([
      "baram-garden-light",
      "default-light",
      "solarized-dark",
      "solarized-light",
      "tokyo-night",
    ]);
  });

  it("solarized-light 는 여섯 쌍 전부를 경고한다", () => {
    const theme = BUILT_IN_THEMES.find((t) => t.id === "solarized-light")!;
    const warnings = contrastWarningsFor("light", theme.modes.light!.colors!);
    expect(warnings).toHaveLength(6);
    for (const w of warnings) {
      expect(w.mode).toBe("light");
      expect(w.ratio).toBeLessThan(4.5);
    }
  });

  // 비공허성: 위 단언들은 함수가 **언제나 빈 배열**이어도 둘이 통과한다.
  // 이것이 그 구현을 배제한다.
  it("읽을 수 없는 조합은 반드시 경고한다", () => {
    const warnings = contrastWarningsFor("light", {
      "--color-bg-default": "#fefefe",
      "--color-text-primary": "#fdfdfd",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.foreground).toBe("--color-text-primary");
    expect(warnings[0]!.background).toBe("--color-bg-default");
    expect(warnings[0]!.ratio).toBeLessThan(1.1);
  });

  it("쌍의 한쪽이 없으면 그 쌍은 검사하지 않는다", () => {
    expect(
      contrastWarningsFor("light", { "--color-text-primary": "#000000" }),
    ).toEqual([]);
  });

  it("읽을 수 없는 값은 경고를 만들지 않는다", () => {
    expect(
      contrastWarningsFor("light", {
        "--color-bg-default": "var(--x)",
        "--color-text-primary": "#000000",
      }),
    ).toEqual([]);
  });
});
