// 분할 계획 (**이주 전용**) — 원문의 어느 줄이 어느 페이지의 어느 heading 레벨로 가는지 결정한다.
// 분할기(split-docs.mjs)와 역조립 게이트(check-roundtrip.mjs)가 **같은 함수**를 쓴다.
// 두 벌이면 역조립이 자기 실수를 따라가서 초록이 된다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, PREAMBLES, TITLES } from "../../ia-tree.mjs";
import { measure } from "./ia-measure.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const readSource = (src) => readFileSync(join(ROOT, src), "utf8").split("\n");

/**
 * 이 페이지에서 heading 을 흡수할 H2 를 고른다.
 *
 * 조건: 페이지의 **첫 단위**가 H2이고, 그 H2 의 H3 자식을 이 페이지가 함께 가져가며,
 * 그런 H2 가 이 페이지에 하나뿐일 때. 그때만 제목이 이미 그 말을 하므로 heading 이 중복된다.
 *
 * ‼️ 조건이 하나라도 어긋나면 흡수하지 않는다 — 여러 H2 를 가진 페이지에서 첫 H2 만 지우면
 *    그 본문이 다음 절 아래로 흘러 들어간다.
 */
export function absorbedH2(units) {
  const h2s = units.filter((u) => u.level === 2);
  if (h2s.length !== 1) return null;
  const [h2] = h2s;
  if (units[0] !== h2) return null;
  return units.some((u) => u.level === 3 && u.parent === h2.text) ? h2.text : null;
}

/**
 * 단위별 heading 레벨 이동량.
 * - 흡수된 H2 → heading 줄을 버린다 (`"drop"`)
 * - H3 의 부모 H2 가 이 페이지에 없거나 흡수됐다 → 이 페이지의 최상위 절이므로 H2 로 승격 (-1)
 * - 그 밖 → 그대로 (0)
 *
 * 본문 안의 H4 는 같은 폭으로 함께 움직여 상대 깊이를 보존한다(user-guide 에 16개 있다).
 */
export function shiftFor(unit, units, absorbed) {
  if (unit.level === 2) return unit.text === absorbed ? "drop" : 0;
  const parentKept = units.some(
    (u) => u.level === 2 && u.text === unit.parent && u.text !== absorbed,
  );
  return parentKept ? 0 : -1;
}

/** 코드 펜스를 피해 heading 줄의 `#` 개수를 delta 만큼 바꾼다. */
export function reheading(lines, delta) {
  if (delta === 0) return lines.slice();
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const m = /^(#{2,6})(\s)/.exec(line);
    if (!m) return line;
    return "#".repeat(m[1].length + delta) + line.slice(m[1].length);
  });
}

/** 페이지 하나의 계획: 어떤 단위를 어떤 이동량으로 가져가는가 */
export function planFor(page, units) {
  const absorbed = absorbedH2(units);
  return {
    absorbed,
    parts: units.map((u) => ({ shift: shiftFor(u, units, absorbed), unit: u })),
    preamble: PREAMBLES.find((d) => d.to === page.slug) ?? null,
    slug: page.slug,
    src: page.src,
    title: TITLES[page.slug],
  };
}

/** 전체 계획. 순서는 PAGES 순서(= 사이드바 순서)다. */
export function plan() {
  const { pages, problems } = measure();
  if (problems.length) {
    throw new Error(
      `IA 에 문제 ${problems.length}건 — 먼저 \`npm run check:ia\`\n  ${problems.join("\n  ")}`,
    );
  }
  const wholeDocSlugs = new Set(PAGES.filter((p) => p.wholeDoc).map((p) => p.slug));
  return pages.map((p) => ({
    ...planFor(p, p.units ?? []),
    synthetic: !!p.synthetic,
    wholeDoc: wholeDocSlugs.has(p.slug),
  }));
}
