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

import { DIALS } from "../../appearance/dials";
import { validateThemeManifest } from "../theme-manifest";

const SOURCE = resolve(__dirname, "../reference/baram-theme.json");
const raw = JSON.parse(readFileSync(SOURCE, "utf8")) as unknown;

/**
 * 레퍼런스가 **일부러** 행사하지 않는 다이얼과 그 이유.
 *
 * ‼️ 이 목록과 레퍼런스가 선언한 다이얼의 합집합이 `DIALS` 와 **정확히** 같아야
 * 한다(양방향). 그래야 새 다이얼을 더한 사람이 "레퍼런스에서 시험할 것인가" 를
 * 반드시 한 번 답하게 된다 — 스펙 §15.6 이 요구하는 것이 그것이다.
 */
const NOT_EXERCISED: Readonly<Record<string, string>> = {
  // 지금은 비어 있다. 0095 가 색 다이얼을, 0097 이 밀도·모서리·배경 대비를
  // 더하면 그 각각에 대해 여기 한 줄이 생기거나 레퍼런스가 값을 싣는다.
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
});
