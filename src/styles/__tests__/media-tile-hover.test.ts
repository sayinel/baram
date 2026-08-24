// §56d 갤러리 칸의 hover는 **무엇 위에 그려지는지 몰라도** 같은 방향이어야 한다.
//
// 원래 규칙은 `opacity: 0.85`였다. 그건 하이라이트가 아니라 칸을 반투명하게 만드는 것이라
// 합성 결과가 `0.85 × 사진 + 0.15 × 패널 배경`이 된다 — 방향이 테마를 따라간다. 실측하면
// 밝은 테마 3개에서는 밝아지고 어두운 테마 5개에서는 **어두워졌다**. 사용자가 다크 테마에서
// "하이라이트가 아니라 어두워진다"고 신고한 것이 정확히 이것이다.
//
// 방향만의 문제도 아니었다: 사진 휘도가 패널 배경과 비슷하면 섞어도 변화가 없어, 다크
// 테마의 어두운 사진에서는 피드백이 아예 사라진다.
//
// 그래서 이 파일이 고정하는 성질은 "이 선언들을 써라"가 아니라 셋이다 — 배경에 의존하는
// 메커니즘을 쓰지 말 것, 방향은 밝아짐일 것, 밝기가 무력한 내용에서도 보일 것.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssRules } from "./css-rules";

const HOVER = cssRules().filter(
  (rule) => rule.selector === ".photo-gallery-item:hover",
);

/** WCAG sRGB 상대 휘도. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 칸 뒤에 실제로 있는 색 — `.app-right-panel`의 `--color-bg-panel` (layout.css). */
function panelBackgrounds(): { hex: string; id: string }[] {
  const src = readFileSync("src/types/theme.ts", "utf8");
  return [
    ...src.matchAll(
      /id:\s*"([\w-]+)"[\s\S]{0,3000}?"--color-bg-panel":\s*"(#[0-9a-fA-F]{3,8})"/gu,
    ),
  ].map((m) => ({ hex: m[2], id: m[1] }));
}

describe("gallery tile hover", () => {
  it("names a rule that exists, so a renamed selector cannot pass silently", () => {
    expect(HOVER).toHaveLength(1);
  });

  // 가드의 전제를 주석이 아니라 값으로 증명한다. 테마들이 한쪽으로만 몰려 있다면
  // "배경 의존이 위험하다"는 이 파일의 근거 자체가 사라진다.
  it("sits on a backdrop that straddles light and dark across the themes", () => {
    const panels = panelBackgrounds();
    expect(panels.length).toBeGreaterThanOrEqual(8);

    const light = panels.filter((p) => luminance(p.hex) > 0.5);
    const dark = panels.filter((p) => luminance(p.hex) <= 0.5);
    expect(light.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
  });

  it("never signals hover by going translucent", () => {
    // `opacity`는 배경을 섞는다 — 위 테스트가 보인 대로 그 배경은 테마마다 반대편에 있다.
    expect(HOVER[0].body).not.toMatch(/(?<!-)\bopacity\s*:/u);
  });

  it("brightens rather than darkens", () => {
    const factor = HOVER[0].body.match(/brightness\(\s*([\d.]+)\s*\)/u);
    expect(factor).not.toBeNull();
    expect(Number(factor![1])).toBeGreaterThan(1);
  });

  it("keeps a signal for the content brightness cannot move", () => {
    // 거의 흰 사진은 곱셈이 클리핑돼 변화가 0이고, 아주 어두운 사진은 절대 변화량이
    // 작다. 두 극단에서 hover를 보이게 하는 것은 링뿐이다.
    expect(HOVER[0].body).toMatch(
      /outline:\s*[^;]*var\(\s*--color-accent-default\s*\)/u,
    );
  });
});
