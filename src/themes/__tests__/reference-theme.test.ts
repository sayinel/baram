// §371.3 — 레퍼런스 테마는 검증 도구다. 이 파일이 그 도구를 돌린다.
//
// 세 가지를 묻는다.
//  (a) 이 매니페스트가 실제 관문을 통과하는가
//  (b) 선언한 다이얼 값이 **하나도 조용히 버려지지 않는가** — 버려진다면 값이
//      범위 밖이거나 앱이 그 다이얼을 모른다는 뜻이고, 후자가 곧 스키마 결함이다
//  (c) 레퍼런스가 행사하지 **않는** 다이얼이 명시적으로 열거돼 있는가 (검증 6)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveColorVars,
  DERIVED_COLOR_KEYS,
} from "../../appearance/color-derive";
import { contrastWarningsFor } from "../../appearance/contrast-report";
import { DIALS } from "../../appearance/dials";
import { validateThemeManifest } from "../theme-manifest";

const SOURCE = resolve(__dirname, "../reference/baram-theme.json");
const raw = JSON.parse(readFileSync(SOURCE, "utf8")) as unknown;

/** `src/themes/reference/{mode}/tokens.json` 을 시드 24키로 읽는다. */
function readReferenceTokens(
  mode: "dark" | "light",
): Readonly<Partial<Record<string, string>>> {
  const path = resolve(__dirname, `../reference/${mode}/tokens.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

/**
 * 레퍼런스가 **일부러** 행사하지 않는 다이얼과 그 이유.
 *
 * ‼️ 이 목록과 레퍼런스가 선언한 다이얼의 합집합이 `DIALS` 와 **정확히** 같아야
 * 한다(양방향). 그래야 새 다이얼을 더한 사람이 "레퍼런스에서 시험할 것인가" 를
 * 반드시 한 번 답하게 된다 — 스펙 §15.6 이 요구하는 것이 그것이다.
 */
const NOT_EXERCISED: Readonly<Record<string, string>> = {
  accentHueShift:
    "이동량 다이얼이라 기준이 테마 자신의 강조 시드다. 레퍼런스는 그 시드를 직접 선언하므로 이동량 0 이 옳고, 0 은 기본값이라 선언할 값이 없다.",
  accentSaturationShift: "위와 같다 — 채도도 시드가 직접 정한다.",
};

describe("레퍼런스 테마 초안", () => {
  it("실제 매니페스트 관문을 통과한다", () => {
    const result = validateThemeManifest(raw);
    expect(result.valid).toBe(true);
  });

  it("선언한 다이얼이 하나도 버려지지 않는다", () => {
    const declared = (raw as { dials: Record<string, unknown> }).dials;
    const result = validateThemeManifest(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // 재구성 결과가 선언과 **같아야** 한다. 부분집합이면 무언가 버려진 것이고,
    // 그 이름이 곧 스키마가 부족한 자리다.
    expect(result.manifest.dials).toEqual(declared);
  });

  it("행사하지 않는 다이얼이 명시적으로 열거돼 있다 (검증 6)", () => {
    const declared = Object.keys(
      (raw as { dials: Record<string, unknown> }).dials,
    );
    const covered = [...declared, ...Object.keys(NOT_EXERCISED)].sort();
    expect(covered).toEqual(DIALS.map((d) => d.id).sort());
  });

  // 무엇이 이것을 실패시키는가: 레퍼런스 시드에 파생의 입력 키가 빠지면
  // 29키가 다 나오지 않는다 — 그러면 이 테마를 입은 사용자에게 callout 색이
  // 기본 팔레트로 남는다. 그것이 이 계획이 고치려던 결함 그 자체다.
  it("레퍼런스 시드에서 파생 29키가 전부 나온다", () => {
    for (const mode of ["light", "dark"] as const) {
      const seeds = readReferenceTokens(mode);
      expect(Object.keys(deriveColorVars(seeds)).sort()).toEqual(
        [...DERIVED_COLOR_KEYS].sort(),
      );
    }
  });

  // 비공허성: 위 단언은 두 모드가 **같은** 색을 내도 통과한다.
  // 레퍼런스가 모드별 팔레트를 갖는다는 것이 이것으로 관측된다.
  it("두 모드의 파생이 서로 다르다", () => {
    const light = deriveColorVars(readReferenceTokens("light"));
    const dark = deriveColorVars(readReferenceTokens("dark"));
    for (const key of DERIVED_COLOR_KEYS) {
      expect(light[key], key).not.toBe(dark[key]);
    }
  });

  // §15 검증 4 — 파생 대비. 레퍼런스는 시험 도구이므로 경고가 없어야 한다.
  it("레퍼런스는 대비 경고를 내지 않는다", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(contrastWarningsFor(mode, readReferenceTokens(mode))).toEqual([]);
    }
  });
});
