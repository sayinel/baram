// §367 색상환. `color-contrast.ts` 가 WCAG 휘도를 다루듯 이 모듈은 HSL 을 다룬다 —
// 둘은 다른 질문에 답한다: 저쪽은 "이 두 색이 읽히는가", 이쪽은 "이 색을 색상환에서
// 얼마나 돌리는가". 파생식(§367.2 "색상환 회전과 대비 보정")이 둘을 다 쓴다.
//
// ‼️ 이 모듈은 아무것도 import 하지 않는다. 파생 엔진과 설정 UI 가 함께 읽는 잎이다.
//
// 왕복(`hslToHex(hexToHsl(c)) === c`)은 **sRGB 정육면체 16,777,216색 전수에서 채널
// 오차 0** 이다 — 계획 0095 작성 시점(2026-09-22)에 한 번 돌려 확인했다. 테스트는
// 시간 때문에 격자 표본을 쓴다. 반올림을 바꾸면 이 성질이 먼저 깨진다.

/** 색상(도, 0~360) · 채도(%, 0~100) · 명도(%, 0~100). */
export interface Hsl {
  readonly h: number;
  readonly l: number;
  readonly s: number;
}

/**
 * `#rgb` · `#rrggbb` → HSL. 그 밖은 전부 `null`.
 *
 * ‼️ alpha(4·8자리)를 **거부**하는 것이 `color-contrast.ts` 의 `parseHexColor` 와
 * 다른 점이고, 의도적이다. 저쪽은 이미 화면에 있는 색의 전경을 고르는 최후 단계라
 * 거부하면 흰색으로 새어 #330 이 재발한다. 이쪽은 파생의 **입력**이라, 절삭해서
 * 받으면 반투명 시드가 불투명한 파생 29키를 낳는다. 시드 계약
 * (`THEME_COLOR_VALUE_RE`, `src/types/theme-color-keys.ts`)도 3·6자리만 받는다.
 */
export function hexToHsl(color: string): Hsl | null {
  const rgb = parseOpaqueHex(color);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, l: l * 100, s: 0 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return { h: h * 60, l: l * 100, s: s * 100 };
}

/** HSL → `#rrggbb`. 색상은 감아 돌고, 채도·명도는 0~100 으로 자른다. */
export function hslToHex({ h, l, s }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s / 100);
  const lum = clamp01(l / 100);
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lum - c / 2;
  const segment = Math.floor(hue / 60) % 6;
  const [r, g, b] = SEGMENTS[segment]!(c, x);
  return `#${[r, g, b]
    .map((channel) => Math.round((channel + m) * 255))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** 색상 육등분마다 어느 채널이 c·x·0 을 갖는가. */
const SEGMENTS: readonly ((
  c: number,
  x: number,
) => [number, number, number])[] = [
  (c, x) => [c, x, 0],
  (c, x) => [x, c, 0],
  (c, x) => [0, c, x],
  (c, x) => [0, x, c],
  (c, x) => [x, 0, c],
  (c, x) => [c, 0, x],
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 불투명 3·6자리 hex 만 0~255 채널로. alpha 와 그 밖은 `null`. */
function parseOpaqueHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  if (hex.length !== 3 && hex.length !== 6) return null;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
