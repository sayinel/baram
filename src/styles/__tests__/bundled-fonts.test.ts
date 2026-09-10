// §347 번들 서체 — 파일이 실재하고, @font-face가 그 파일을 가리키고,
// 토큰 스택의 첫 항목이 그 패밀리명인지.
//
// jsdom은 폰트를 로드하지 않으므로 "적용됨"은 이 파일이 증명할 수 없다. 여기서
// 막는 것은 그보다 앞의 실패다 — 이름만 있고 파일이 없던 §346의 상태.
import type { BundledFont } from "../../utils/font/bundled-fonts";

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUNDLED_FAMILY_KEYS,
  BUNDLED_FONTS,
  bundledFamily,
  bundledFont,
} from "../../utils/font/bundled-fonts";

const ROOT = process.cwd();
const FONT_DIR = path.join(ROOT, "src/assets/fonts");
const FONTS_CSS = path.join(ROOT, "src/styles/fonts.css");

/** 파일별 최소 바이트 — 이름 계약이 아니라 크기 sanity check이므로 로컬 표로 둔다. */
const MIN_BYTES: Record<string, number> = {
  "PretendardVariable.woff2": 1_500_000,
  "jetbrains-mono-latin-wght-normal.woff2": 20_000,
};

/** 스택 첫 항목의 인용부호를 벗겨 비교한다 — 생성된 CSS는 다단어 패밀리명을
 * 따옴표로 감싸고 단일 단어는 소문자화한다 (Style Dictionary CSS formatter). */
const firstFamily = (stack: string): string =>
  stack
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/gu, "")
    .toLowerCase();

describe("§347 bundled fonts", () => {
  it("ships every declared woff2 file, non-empty", () => {
    for (const { fileName } of BUNDLED_FONTS) {
      const p = path.join(FONT_DIR, fileName);
      expect(existsSync(p), `${fileName} missing`).toBe(true);
      expect(statSync(p).size, `${fileName} too small`).toBeGreaterThan(
        MIN_BYTES[fileName],
      );
    }
  });

  it("ships an OFL copy for each bundled family", () => {
    for (const name of ["OFL-Pretendard.txt", "OFL-JetBrainsMono.txt"]) {
      const p = path.join(FONT_DIR, name);
      expect(existsSync(p), `${name} missing`).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(1_000);
    }
  });

  // 이 단정이 §346의 결함을 재발 불가로 만든다: 이름을 지목하면서 파일을
  // 안 넣는 상태가 곧 실패다.
  it("declares an @font-face per family whose src resolves to a shipped file", () => {
    const css = readFileSync(FONTS_CSS, "utf8");
    for (const { family, fileName } of BUNDLED_FONTS) {
      expect(css, `no @font-face for ${family}`).toContain(`"${family}"`);
      const srcMatch = new RegExp(
        `font-family:\\s*"${family}"[\\s\\S]*?src:\\s*url\\(["']?([^"')]+)["']?\\)`,
        "u",
      ).exec(css);
      expect(srcMatch, `no src for ${family}`).not.toBeNull();
      const referenced = path.basename(srcMatch![1]);
      expect(referenced).toBe(fileName);
      expect(existsSync(path.join(FONT_DIR, referenced))).toBe(true);
    }
  });

  it("puts each bundled family FIRST in its generated token stack", () => {
    const primitives = readFileSync(
      path.join(ROOT, "src/styles/generated/primitives.css"),
      "utf8",
    );
    const stack = (name: string) =>
      new RegExp(`--font-family-${name}:\\s*([^;]+);`, "u")
        .exec(primitives)?.[1]
        .replace(/\s+/gu, " ")
        .trim() ?? "";
    // 역할은 선언된 `role` 로 읽는다. 배열 순서로 짚거나 이름에 "mono"가 든
    // 것으로 추론하면 항목이 늘거나 이름이 바뀔 때 조용히 반대쪽을 단정한다.
    const family = (role: BundledFont["role"]) =>
      BUNDLED_FONTS.find((f) => f.role === role)?.family.toLowerCase();
    expect(firstFamily(stack("editor"))).toBe(family("body"));
    expect(firstFamily(stack("mono"))).toBe(family("code"));
  });

  // 역할은 정확히 한 항목씩이다. 둘 중 하나가 비면 위 단정이 `undefined` 를
  // 비교하게 되고, 그 역할로 폴백 스택을 만드는 `font-surfaces.ts` 는 던진다.
  it.each(["body", "code"] as const)(
    "declares exactly one bundled font for the %s role",
    (role) => {
      expect(BUNDLED_FONTS.filter((f) => f.role === role)).toHaveLength(1);
    },
  );

  it("imports fonts.css before any stylesheet that names a bundled family", () => {
    const index = readFileSync(path.join(ROOT, "src/styles/index.css"), "utf8");
    const imports = [...index.matchAll(/@import\s+"\.\/([^"]+)"/gu)].map(
      (m) => m[1],
    );
    expect(imports[0]).toBe("fonts.css");
  });

  // BUNDLED_FAMILY_KEYS는 이 태스크의 소비자가 아직 없다 (가용성 판정은 이후
  // 태스크의 몫이다) — 그래도 그 단일 출처가 스스로 어긋나지 않는지는 지금
  // 지켜야 한다.
  it("derives BUNDLED_FAMILY_KEYS from exactly the lowercased bundled family names", () => {
    expect([...BUNDLED_FAMILY_KEYS].sort()).toEqual(
      BUNDLED_FONTS.map((f) => f.family.toLowerCase()).sort(),
    );
  });

  // 이 두 함수가 이제 단일 출처를 "역할로 꺼내는" 유일한 방법이다 — 같은
  // `find(role) → throw → 인용` 관용구가 세 파일에 복제돼 있었고 네 번째가
  // 필요해져서 여기로 올렸다 (final review C1 / T8-1).
  it.each(["body", "code"] as const)(
    "derives the %s role's font and its quoted CSS form from BUNDLED_FONTS",
    (role) => {
      const declared = BUNDLED_FONTS.find((f) => f.role === role);
      expect(bundledFont(role)).toBe(declared);
      // 인용은 장식이 아니다: 두 패밀리명 모두 공백이 든 다단어라서 인용이
      // 없으면 CSS가 <custom-ident> 열로 파싱한다.
      expect(bundledFamily(role)).toBe(`"${declared?.family}"`);
    },
  );
});
