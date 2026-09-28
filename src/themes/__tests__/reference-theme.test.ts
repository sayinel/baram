// §371.3 — 레퍼런스 테마는 검증 도구다. 이 파일이 그 도구를 돌린다.
//
// 묻는 것을 묶으면 이렇다.
//  (a) 매니페스트: 실제 관문을 통과하는가, 선언한 다이얼 값이 **하나도 조용히 버려지지
//      않는가** — 버려진다면 값이 범위 밖이거나 앱이 그 다이얼을 모른다는 뜻이고, 후자가
//      곧 스키마 결함이다 — 그리고 크롬을 싣지 않는가(D10) · 하한이 v0.7.7 인가(D3)
//  (b) 레퍼런스가 행사하지 **않는** 다이얼이 명시적으로 열거돼 있는가 (검증 6)
//  (c) 색(D12): 경고가 강조와 색상으로 갈리는가, 강조가 AA 를 넘는가, 두 모드의
//      시드에서 파생 29키가 다 나오고 모드끼리 다른가, 대비 경고가 없는가
//
// 스펙 0063 D8 — 이 매니페스트는 더 이상 초안이 아니다. "한글로 글을 쓰는 사람을
// 위한 기본 테마" Baram Hangul 로 출고되며, 검증 도구라는 역할은 그대로 남는다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveColorVars,
  DERIVED_COLOR_KEYS,
} from "../../appearance/color-derive";
import { hexToHsl } from "../../appearance/color-hsl";
import { contrastWarningsFor } from "../../appearance/contrast-report";
import { DIALS } from "../../appearance/dials";
import { AA_TEXT_RATIO, contrastRatio } from "../../utils/color-contrast";
import { validateThemeManifest } from "../theme-manifest";

const SOURCE = resolve(
  __dirname,
  "../../../examples/themes/hangul/baram-theme.json",
);
const raw = JSON.parse(readFileSync(SOURCE, "utf8")) as unknown;

/** `examples/themes/hangul/{mode}/tokens.json` 을 시드 24키로 읽는다. */
function readReferenceTokens(
  mode: "dark" | "light",
): Readonly<Partial<Record<string, string>>> {
  const path = resolve(
    __dirname,
    `../../../examples/themes/hangul/${mode}/tokens.json`,
  );
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

/**
 * 두 hex 색의 색상(hue) 거리(도, 0~180) — 색상환 위 최단 거리.
 *
 * `hexToHsl` 이 hex 가 아닌 값에 `null` 을, 무채색에 `s: 0`·`h: 0` 을 돌려주는데
 * 두 경우 다 색상 비교가 뜻을 잃는다 — 조용히 통과하지 않도록 던진다.
 */
function hueDistance(a: string, b: string): number {
  const ha = hexToHsl(a);
  const hb = hexToHsl(b);
  if (ha === null || hb === null) {
    throw new Error(`hueDistance: hex 색이 아니다 — ${a}, ${b}`);
  }
  if (ha.s === 0 || hb.s === 0) {
    throw new Error(`hueDistance: 무채색은 색상이 없다 — ${a}, ${b}`);
  }
  const d = Math.abs(ha.h - hb.h);
  return Math.min(d, 360 - d);
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
  // 스펙 0063 D11 — 배경 대비는 라이트 · 다크 모두 행사하지 않는다.
  backgroundContrastDark:
    "순흑은 한글 본문 조판과 무관한 색 중심 선택이다 — 0055 §10.3 이 '색 중심 테마(… OLED 순흑)는 값만 바꾸면 되므로 나중에 싸게 얹힌다' 고 적는다",
  // 스펙 0063 D11 — 기본 테마다. 초안의 `flat` 은 표시줄을 숨기는 몰입형 전제에서 나왔다.
  backgroundContrastLight:
    "기본 테마다. 패널 · 표시줄이 본문과 구분되는 앱 기본을 따른다. 초안의 `flat` 은 표시줄을 숨기는 몰입형 전제에서 나왔다.",
  // 스펙 0063 D11 — 한글과 무관하다. 초안은 매니페스트 경로를 행사하려고 골랐다.
  cornerRadius:
    "한글과 무관하다. 초안은 매니페스트 경로를 행사하려고 `round` 를 골랐다.",
  // 스펙 0063 D11 — 기본 테마다. 초안의 `compact` 는 표시줄을 숨기는 몰입형 전제에서 나왔다.
  density:
    "기본 테마다. 초안의 `compact` 는 표시줄을 숨기는 몰입형 전제에서 나왔다.",
  // §369 리스트 가이드. 레퍼런스가 이 다이얼을 싣지 **않는** 것이 답이다 —
  // 이 기능에서 테마의 축은 농도가 아니라 색조(`--color-editor-guide-tint`)이고,
  // 그것은 다이얼이 아니라 팔레트로 싣는다. 레퍼런스의 `tokens.json` 은 그 키를
  // 싣지 않고(24키 — #722 의 커밋이 조상에 없는 브랜치에서 만들어졌다), 설치할 때
  // `fillAliasedColors` 가 본문 글자색으로 채운다. 다이얼로 농도를 싣는 것은 "농도는
  // 사용자 축" 이라는 설계를 레퍼런스가 거스르는 모양이 된다.
  editorListGuideStrength: "테마의 축은 색조(팔레트)이고, 농도는 사용자 축이다",
  // 스펙 0060 §9.1 — 코드는 이 테마의 초점이 아니다(한글로 글을 쓰는 사람을 위한 기본
  // 테마, 스펙 0063 D8).
  editorCodeFontFamily:
    "코드는 이 테마의 초점이 아니다 — 한글로 글을 쓰는 사람을 위한 기본 테마(스펙 0063 D8)이고, 코드 서체는 사용자 축으로 둔다",
  // 스펙 0063 D11 — 앱 기본 1.75 와 초안 1.8 의 차이는 17px 에서 줄마다 0.85px 다.
  editorLineHeight:
    "앱 기본 1.75 와 초안 1.8 의 차이는 17px 에서 줄마다 0.85px 다.",
  // 스펙 0063 D11 — 앱 기본(폭 800 · 여백 4)에서 한글 줄당 약 46자다.
  editorMaxWidth:
    "앱 기본 800 · 여백 4 에서 한글 줄당 약 46자다(17px · 자간 −0.01em). 쓰는 동안 표 · 코드 블록에도 자리가 남는다.",
  // 스펙 0063 D11 — 한글과 무관하다. 앱 기본은 `dials.ts` 주석의 기하 근거로 고른 값이다.
  editorOrderedMarkerAlign:
    "한글과 무관하다. 앱 기본 `number` 는 `dials.ts` 주석의 기하 근거로 고른 값이다.",
  // 스펙 0063 D11 — 본문 폭과 한 묶음이다.
  editorPadding: "본문 폭과 한 묶음이다.",
};

describe("레퍼런스 테마 Baram Hangul", () => {
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

  // 스펙 0063 D10 — 기본 테마는 화면 구성을 건드리지 않는다. 무엇이 이것을 실패시키는가:
  // 누군가 `chrome` 을 되살리면. 크롬 제안 경로 자체는 `focus-theme-fixture.test.ts` 의
  // 픽스처로 시험한다.
  it("크롬을 제안하지 않는다", () => {
    expect((raw as Record<string, unknown>).chrome).toBeUndefined();
    const result = validateThemeManifest(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.chrome).toBeUndefined();
  });

  // 스펙 0063 D3 — 하한이 Low-4(파일 설치본 출처 표시)가 든 첫 릴리스 아래로 내려가면
  // 옛 앱 사용자에게 파일 사본이 레지스트리 테마로 보이는 경우가 열린다.
  it("하한이 v0.7.7 이다", () => {
    const result = validateThemeManifest(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.engines.baram).toBe(">=0.7.7");
  });

  // 스펙 0063 D12 — 초안은 경고색이 강조색과 겹쳤다(다크에서 같은 값, 라이트에서 색상 차
  // 1.6°). `color-derive.ts` 가 정보 콜아웃을 강조에서, 경고 콜아웃을 경고에서 그대로
  // 가져오므로 두 콜아웃이 다크에서는 같은 색, 라이트에서는 거의 같은 색상이 됐다. 앱의
  // `contrastWarningsFor` 는 글자 · 배경 쌍만 보므로 이것을 잡지 못한다 — 여기서 직접 본다.
  it("경고색이 강조색과 색상으로 갈린다", () => {
    for (const mode of ["light", "dark"] as const) {
      const seeds = readReferenceTokens(mode);
      const accent = seeds["--color-accent-default"];
      const warning = seeds["--color-status-warning"];
      expect(accent, mode).toBeDefined();
      expect(warning, mode).toBeDefined();
      expect(hueDistance(accent!, warning!), mode).toBeGreaterThanOrEqual(30);
    }
  });

  // 링크는 강조색 글자다. 앱의 대비 보고는 이 쌍을 보지 않는다(위와 같은 이유).
  it("강조색이 본문 배경 위에서 AA 를 넘는다", () => {
    for (const mode of ["light", "dark"] as const) {
      const seeds = readReferenceTokens(mode);
      const ratio = contrastRatio(
        seeds["--color-accent-default"]!,
        seeds["--color-editor-bg"]!,
      );
      expect(ratio, mode).not.toBeNull();
      expect(ratio!, mode).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    }
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
