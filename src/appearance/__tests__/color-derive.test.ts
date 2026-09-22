// §367 시드에서 나머지 색을 계산한다. 이 파일이 지키는 것은 셋이다:
// (1) 계산할 수 있는 키만 낸다, (2) 기본 라이트 팔레트에서 오늘 값 근처에 착지한다,
// (3) 모드 차이는 시드에서 온다 — 함수는 모드를 모른다.
import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { deriveColorVars, DERIVED_COLOR_KEYS } from "../color-derive";
import { hexToHsl } from "../color-hsl";

/** 두 색상 사이의 최단 각. */
function hueGap(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

describe("DERIVED_COLOR_KEYS", () => {
  // 무엇이 이것을 실패시키는가: 규칙표에 키를 더하고 이 배열에 안 더하면
  // `clearThemeVars`(Task 4)가 그 키를 지우지 않아, 테마를 바꿔도 앞 테마의
  // 색이 하나 남는다 — #330 의 모양 그대로다.
  it("엔진이 낼 수 있는 키를 전부 담는다", () => {
    const emitted = Object.keys(deriveColorVars(defaultColorsForBase("light")));
    expect([...emitted].sort()).toEqual([...DERIVED_COLOR_KEYS].sort());
  });

  it("29키다", () => {
    expect(DERIVED_COLOR_KEYS).toHaveLength(29);
  });

  it("전부 `--color-` 로 시작하고 category 는 정해진 아홉 중 하나다", () => {
    // CLAUDE.md 의 CSS 변수 규약. tokens/semantic/color-light.json 이 canonical.
    const CATEGORIES = [
      "accent",
      "bg",
      "border",
      "callout",
      "editor",
      "git",
      "graph",
      "status",
      "text",
    ];
    for (const key of DERIVED_COLOR_KEYS) {
      const category = key.replace("--color-", "").split("-")[0];
      expect(CATEGORIES, key).toContain(category);
    }
  });
});

describe("deriveColorVars — 희소성", () => {
  // 무엇이 이것을 실패시키는가: 시드가 없는데도 키를 내면 그 값은 무엇에서
  // 나온 것도 아니고, `<html>` 인라인이 되어 cascade 를 가린다. `system` 에서
  // 그것이 일어나면 OS 전환이 깨진다(§364.2).
  it("시드가 하나도 없으면 아무것도 내지 않는다", () => {
    expect(deriveColorVars({})).toEqual({});
  });

  it("강조색만 있으면 강조에서 나오는 것만 낸다", () => {
    const out = deriveColorVars({ "--color-accent-default": "#3b82f6" });
    expect(Object.keys(out).sort()).toEqual(
      [
        "--color-callout-abstract",
        "--color-callout-info",
        "--color-callout-todo",
        "--color-git-staged",
        "--color-graph-neighbor",
        "--color-graph-cross-vault",
        "--color-status-info",
      ].sort(),
    );
    // `--color-bg-selection` 은 강조에서 나오지만 배경 기준 명도 이동이 있어
    // `--color-bg-default` 없이는 계산할 수 없다 — 그래서 위 목록에 없다.
    expect(out).not.toHaveProperty("--color-bg-selection");
  });

  it("명도 이동이 있는 키는 그 기준 시드가 있어야 나온다", () => {
    const withoutBg = deriveColorVars({ "--color-status-danger": "#ef4444" });
    expect(withoutBg).not.toHaveProperty("--color-status-error-bg");
    const withBg = deriveColorVars({
      "--color-bg-default": "#ffffff",
      "--color-status-danger": "#ef4444",
    });
    expect(withBg).toHaveProperty("--color-status-error-bg");
  });

  it("파싱 불가한 시드는 없는 것으로 친다", () => {
    expect(deriveColorVars({ "--color-accent-default": "var(--x)" })).toEqual(
      {},
    );
  });

  it("낯선 키는 무시한다 — 출력은 언제나 규칙표 안이다", () => {
    const out = deriveColorVars({
      "--color-accent-default": "#3b82f6",
      display: "none",
    } as Record<string, string>);
    for (const key of Object.keys(out)) {
      expect(DERIVED_COLOR_KEYS, key).toContain(key);
    }
  });
});

describe("deriveColorVars — 기본 팔레트 온전성", () => {
  // 무엇이 이것을 실패시키는가: 시드를 잘못 고르거나 회전 부호를 뒤집으면
  // 여기서 색상이 수십 도 어긋난다. 이 테스트는 **재현 요구가 아니다** —
  // 파생 엔진은 기본 테마에 도달하지 않는다(`appliesInlineVars` 가 막는다).
  // 경계는 실측이다: 라이트에서 최대 Δ색상 4.1°(graph-active-border),
  // 최대 Δ명도 17.1(callout-todo). primitive 계단(cyan-500 은 blue-500 의
  // 순수 회전이 아니다)이 그 오차의 출처다.
  it("기본 라이트 시드에서 오늘 라이트 값 근처에 착지한다", () => {
    const out = deriveColorVars(defaultColorsForBase("light"));
    // 오늘 값은 생성된 스타일시트가 canonical 이므로 여기 표본 넷만 전사한다.
    const TODAY: Record<string, string> = {
      "--color-callout-danger": "#ef4444",
      "--color-callout-info": "#3b82f6",
      "--color-git-staged": "#3b82f6",
      "--color-status-info": "#3b82f6",
    };
    for (const [key, today] of Object.entries(TODAY)) {
      expect(out[key], key).toBe(today);
    }
  });

  it("회전이 있는 키는 색상이 그만큼 돈다", () => {
    const seeds = defaultColorsForBase("light");
    const out = deriveColorVars(seeds);
    const accent = hexToHsl(seeds["--color-accent-default"])!;
    const abstract = hexToHsl(out["--color-callout-abstract"]!)!;
    expect(hueGap(abstract.h, accent.h + 41)).toBeLessThan(1);
    const todo = hexToHsl(out["--color-callout-todo"]!)!;
    expect(hueGap(todo.h, accent.h - 28)).toBeLessThan(1);
  });
});

describe("deriveColorVars — 모드 차이는 시드에서 온다", () => {
  // 무엇이 이것을 실패시키는가: 함수 안에 모드 분기를 넣으면 이 테스트가
  // 통과할 수 없다 — 함수는 모드를 인자로 받지 않으므로, 두 결과가 다르다면
  // 그 차이는 시드에서만 올 수 있다. 그것이 이 설계의 전부다.
  it("같은 함수가 라이트·다크 시드에서 다른 답을 낸다", () => {
    const light = deriveColorVars(defaultColorsForBase("light"));
    const dark = deriveColorVars(defaultColorsForBase("dark"));
    expect(light["--color-bg-hover"]).not.toBe(dark["--color-bg-hover"]);
    expect(light["--color-status-error-bg"]).not.toBe(
      dark["--color-status-error-bg"],
    );
  });

  // 비공허성: 위 단언은 두 팔레트가 시드를 공유하는 키에서는 **같아야** 한다.
  // 실측: `--color-status-danger` 는 두 기본 팔레트에서 같은 `#ef4444` 다.
  it("시드가 같으면 파생도 같다", () => {
    const light = deriveColorVars(defaultColorsForBase("light"));
    const dark = deriveColorVars(defaultColorsForBase("dark"));
    expect(light["--color-callout-danger"]).toBe(
      dark["--color-callout-danger"],
    );
  });
});
