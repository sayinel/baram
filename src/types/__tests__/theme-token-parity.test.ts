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
import { describe, expect, it } from "vitest";

import primitives from "../../../tokens/primitive/color.json";
import darkSemantic from "../../../tokens/semantic/color-dark.json";
import lightSemantic from "../../../tokens/semantic/color-light.json";
import { BUILT_IN_THEMES, THEME_COLOR_KEYS } from "../theme";

type TokenNode = { $value: string } | { [key: string]: TokenNode };

/**
 * `{color.yellow.500}` 참조를 실값으로 해석한다. primitive에서 먼저 찾고, 없으면
 * 같은 semantic 트리에서 재귀 해석한다 — 소스에는 semantic이 semantic을 가리키는
 * 별칭도 있다(예: editor.text → text.primary).
 */
function resolveValue(value: string, semanticRoot: TokenNode): string {
  if (!value.startsWith("{")) return value;
  const path = value.slice(1, -1).split(".");
  const dig = (root: TokenNode): null | TokenNode => {
    let node: TokenNode | undefined = root;
    for (const part of path) {
      node = (node as Record<string, TokenNode>)[part];
      if (node === undefined) return null;
    }
    return node;
  };
  const hit = dig(primitives as unknown as TokenNode) ?? dig(semanticRoot);
  if (hit === null || !("$value" in hit) || typeof hit.$value !== "string") {
    throw new Error(`해석 불가 참조: ${value}`);
  }
  return resolveValue(hit.$value, semanticRoot);
}

/** semantic 트리를 `--color-…` 이름으로 평탄화한다. camelCase 조각은 kebab으로 —
 *  style-dictionary의 CSS 변수 이름 변환과 같은 규칙이다(lineHighlight → line-highlight). */
function flattenSemantic(
  root: Record<string, TokenNode>,
  semanticFile: TokenNode,
): Map<string, string> {
  const out = new Map<string, string>();
  const kebab = (s: string): string =>
    s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const walk = (node: Record<string, TokenNode>, path: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== "object" || value === null) continue;
      if ("$value" in value && typeof value.$value === "string") {
        out.set(
          `--color-${[...path, kebab(key)].join("-")}`,
          resolveValue(value.$value, semanticFile),
        );
      } else {
        walk(value as Record<string, TokenNode>, [...path, kebab(key)]);
      }
    }
  };
  walk(root, []);
  return out;
}

const LIGHT = flattenSemantic(
  (lightSemantic as unknown as { color: Record<string, TokenNode> }).color,
  lightSemantic as unknown as TokenNode,
);
const DARK = flattenSemantic(
  (darkSemantic as unknown as { color: Record<string, TokenNode> }).color,
  darkSemantic as unknown as TokenNode,
);

describe("기본 테마 팔레트 ↔ DTCG 소스 parity", () => {
  const cases = [
    ["default-light", LIGHT],
    ["default-dark", DARK],
  ] as const;

  for (const [themeId, tokens] of cases) {
    it(`${themeId}의 editable 25색이 semantic 토큰 값과 일치한다`, () => {
      const theme = BUILT_IN_THEMES.find((t) => t.id === themeId)!;
      const drifted: string[] = [];
      for (const { key } of THEME_COLOR_KEYS) {
        const source = tokens.get(key);
        expect(source, `${key}가 semantic 소스에 없다`).toBeDefined();
        if (theme.colors[key].toLowerCase() !== source!.toLowerCase()) {
          drifted.push(`${key}: palette=${theme.colors[key]} source=${source}`);
        }
      }
      expect(drifted, "표류한 슬롯").toEqual([]);
    });
  }
});
