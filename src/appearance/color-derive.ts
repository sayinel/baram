// §367 시드에서 파생. 테마가 고르는 시드 24키(`THEME_COLOR_KEYS`)에서 의미가 고정된
// 계열 29키를 계산한다 — callout 13 · graph 7 · git 4 · status 3 · bg 2.
//
// ‼️ 모드를 인자로 받지 않는다. 모드 의존은 **시드가 이미 갖고 있다**:
// `modes.light.colors` 와 `modes.dark.colors` 가 서로 다른 시드를 주므로 같은 식이
// 모드마다 다른 답을 낸다. 모드를 또 받으면 같은 정보가 두 경로로 들어오고, 두
// 경로는 어긋나는 날이 온다.
//
// ‼️ 대비 하한을 **두지 않는다**. 오늘의 기본 라이트 팔레트에서 마크 계열 25키 중
// 13키가 배경 대비 3:1 미만이다(실측 2026-09-22, 최저 `graph-orphan` 1.47).
// 하한을 걸면 저자가 고른 색을 앱이 말없이 옮기고 오늘 화면 13곳이 움직인다.
// 스펙 §367.3 의 대비 관문은 **설치 시점의 경고**이지 계산의 일부가 아니다 —
// 그 절이 "거부가 아니라 경고" 라고 적는 이유가 그것이다(`theme-install.ts`).
//
// 상수(Δ°, 이동 비율)는 기본 라이트 팔레트의 오늘 값에서 역산했다. 파생 엔진은
// 기본 테마에 도달하지 않으므로(`appliesInlineVars`) 그 수치는 **재현 요구가 아니라
// 온전성 기준**이다 — 시드를 잘못 고르거나 회전 부호를 뒤집으면 거기서 먼저 깨진다.

import { hexToHsl, hslToHex } from "./color-hsl";

/**
 * 이 엔진이 **낼 수 있는** 키 전부(29개). `clearThemeVars` 가 이 배열을 지운다.
 *
 * ‼️ `RULES.map((r) => r.key)` 가 아니라 리터럴 배열이다 — `RULES` 는 이 파일
 * 아래쪽에 있고(`perfectionist/sort-modules` 의 알파벳 순 요구), `const` 는
 * 호이스팅되지 않으므로 `RULES` 를 여기서 참조하면 런타임 TDZ 오류다. 대신
 * `color-derive.test.ts` 의 첫 테스트("엔진이 낼 수 있는 키를 전부 담는다")가
 * 이 배열과 `RULES` 의 키 집합이 같음을 고정한다 — 규칙을 더하고 여기 안
 * 더하면 그 테스트가 잡는다.
 */
export const DERIVED_COLOR_KEYS: readonly string[] = [
  "--color-callout-tip",
  "--color-callout-info",
  "--color-callout-warning",
  "--color-callout-danger",
  "--color-callout-note",
  "--color-callout-abstract",
  "--color-callout-todo",
  "--color-callout-example",
  "--color-callout-question",
  "--color-callout-bug",
  "--color-callout-success",
  "--color-callout-failure",
  "--color-callout-quote",
  "--color-graph-active-border",
  "--color-graph-neighbor",
  "--color-graph-orphan",
  "--color-graph-pinned",
  "--color-graph-label",
  "--color-graph-tag",
  "--color-graph-cross-vault",
  "--color-git-added",
  "--color-git-deleted",
  "--color-git-staged",
  "--color-git-modified",
  "--color-status-info",
  "--color-status-error-bg",
  "--color-status-error-border",
  "--color-bg-hover",
  "--color-bg-selection",
];

/**
 * 시드에서 계산할 수 있는 키만 돌려준다.
 *
 * "계산할 수 있는 것만" 이 §364.2 희소성 불변식의 색 버전이다. 시드가 인라인에
 * 없다는 것은 그 값을 cascade 가 소유한다는 뜻이고, 그 위에서 파생값을 인라인으로
 * 박으면 미디어 쿼리를 눌러 이긴다 — `system` 에서 OS 전환이 깨지는 그 사고다.
 *
 * 입력은 외부에서 온다(저장된 테마·매니페스트). 그래서 **입력이 아니라 {@link RULES}
 * 를 순회한다** — `applyThemeVars` 의 감사 BLOCKER 와 같은 이유다.
 */
export function deriveColorVars(
  seeds: Readonly<Partial<Record<string, string>>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of RULES) {
    const source = hexToHsl(seeds[rule.seed] ?? "");
    if (source === null) continue;
    let lightness = source.l;
    if (rule.lift !== null) {
      const anchor = hexToHsl(seeds[rule.lift.anchor] ?? "");
      // 기준 시드가 없으면 이 키는 계산할 수 없다. 이동 없이 내보내면 그것은
      // 규칙표가 말한 색이 아니다 — 내지 않는 것이 옳다.
      if (anchor === null) continue;
      lightness = source.l + rule.lift.amount * (anchor.l - source.l);
    }
    out[rule.key] = hslToHex({
      h: source.h + rule.hue,
      l: lightness,
      s: source.s,
    });
  }
  return out;
}

/** 명도를 어느 시드 쪽으로 얼마나 옮기는가. 비율이므로 테마가 어두우면 방향도 뒤집힌다. */
interface Lift {
  readonly amount: number;
  readonly anchor: string;
}

interface Rule {
  readonly hue: number;
  readonly key: string;
  readonly lift: Lift | null;
  readonly seed: string;
}

const ACCENT = "--color-accent-default";
const BG = "--color-bg-default";
const DANGER = "--color-status-danger";
const SUCCESS = "--color-status-success";
const TEXT = "--color-text-primary";
const TEXT2 = "--color-text-secondary";
const WARNING = "--color-status-warning";

const RULES: readonly Rule[] = [
  { hue: 0, key: "--color-callout-tip", lift: null, seed: SUCCESS },
  { hue: 0, key: "--color-callout-info", lift: null, seed: ACCENT },
  { hue: 0, key: "--color-callout-warning", lift: null, seed: WARNING },
  { hue: 0, key: "--color-callout-danger", lift: null, seed: DANGER },
  { hue: 0, key: "--color-callout-note", lift: null, seed: TEXT2 },
  { hue: 41, key: "--color-callout-abstract", lift: null, seed: ACCENT },
  { hue: -28, key: "--color-callout-todo", lift: null, seed: ACCENT },
  { hue: 13, key: "--color-callout-example", lift: null, seed: SUCCESS },
  { hue: 0, key: "--color-callout-question", lift: null, seed: WARNING },
  { hue: 0, key: "--color-callout-bug", lift: null, seed: DANGER },
  { hue: -18, key: "--color-callout-success", lift: null, seed: SUCCESS },
  {
    hue: 0,
    key: "--color-callout-failure",
    lift: { amount: 0.192, anchor: TEXT },
    seed: DANGER,
  },
  {
    hue: 0,
    key: "--color-callout-quote",
    lift: { amount: 0.349, anchor: BG },
    seed: TEXT2,
  },
  {
    hue: 0,
    key: "--color-graph-active-border",
    lift: { amount: 0.2, anchor: BG },
    seed: "--color-graph-active",
  },
  { hue: 41, key: "--color-graph-neighbor", lift: null, seed: ACCENT },
  {
    hue: 0,
    key: "--color-graph-orphan",
    lift: { amount: 0.542, anchor: BG },
    seed: "--color-graph-edge",
  },
  { hue: 0, key: "--color-graph-pinned", lift: null, seed: WARNING },
  {
    hue: 0,
    key: "--color-graph-label",
    lift: { amount: 0.541, anchor: TEXT },
    seed: TEXT2,
  },
  { hue: 0, key: "--color-graph-tag", lift: null, seed: SUCCESS },
  { hue: 41, key: "--color-graph-cross-vault", lift: null, seed: ACCENT },
  { hue: -18, key: "--color-git-added", lift: null, seed: SUCCESS },
  { hue: 0, key: "--color-git-deleted", lift: null, seed: DANGER },
  { hue: 0, key: "--color-git-staged", lift: null, seed: ACCENT },
  {
    hue: 0,
    key: "--color-git-modified",
    lift: { amount: 0.127, anchor: TEXT },
    seed: WARNING,
  },
  { hue: 0, key: "--color-status-info", lift: null, seed: ACCENT },
  {
    hue: 0,
    key: "--color-status-error-bg",
    lift: { amount: 0.931, anchor: BG },
    seed: DANGER,
  },
  {
    hue: 0,
    key: "--color-status-error-border",
    lift: { amount: 0.734, anchor: BG },
    seed: DANGER,
  },
  {
    hue: 0,
    key: "--color-bg-hover",
    lift: { amount: 0.027, anchor: TEXT },
    seed: "--color-bg-subtle",
  },
  {
    hue: 0,
    key: "--color-bg-selection",
    lift: { amount: 0.82, anchor: BG },
    seed: ACCENT,
  },
];
