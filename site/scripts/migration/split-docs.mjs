#!/usr/bin/env node
// 원문 4개를 IA 트리대로 57페이지로 분할해 site/src/content/docs/en/docs/ 에 쓴다.
// **이주 전용**: 되풀이 실행이 안전하지만(같은 입력 → 같은 출력), 이주가 끝나면 다시 돌리지
// 않는다 — 그 뒤에는 번역이 이 파일들을 편집하므로 덮어쓰면 번역이 사라진다.
//
// ‼️ 손실 없음은 `check-roundtrip.mjs` 가 증명한다 — 생성된 페이지들을 다시 원문으로
//    조립해 바이트 동일성을 단정한다. 페이지를 눈으로 훑는 것으로는 증명되지 않는다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, groupOf, PAGES, TITLES } from "../../ia-tree.mjs";
import { ROUTES } from "../../routes.mjs";
import { buildAnchorIndex, rewriteLinks } from "./link-map.mjs";
import { plan, readSource, reheading } from "./split-plan.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src/content/docs/en/docs");

/** 프론트매터. description 은 두지 않는다 — 없으면 Starlight 이 본문에서 뽑고, 두면 낡는다. */
const frontmatter = (title) => `---\ntitle: ${JSON.stringify(title)}\n---\n`;

/** 파일 머리말에서 H1 줄을 뺀 나머지. Starlight 이 title 을 H1 으로 렌더하므로 중복을 지운다. */
function preambleBody(src) {
  const lines = readSource(src);
  const firstHeading = lines.findIndex((l) => /^#{2,3}\s/.test(l));
  const end = firstHeading === -1 ? lines.length : firstHeading;
  return lines.slice(0, end).filter((l, i) => !(i === 0 && /^#\s/.test(l)));
}

/** 문서 홈 — 원문에 대응물이 없어 그룹 목록을 매니페스트에서 생성한다. */
function indexBody(intro) {
  const out = [...intro];
  const seen = new Set();
  for (const page of PAGES) {
    if (page.slug === "index") continue;
    const group = groupOf(page.slug);
    const label = group ? GROUPS[group].en : TITLES[page.slug];
    const target = group ? PAGES.find((p) => groupOf(p.slug) === group)?.slug : page.slug;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(`- [${label}](/baram/en/docs/${target}/)`);
  }
  return out;
}

// ‼️ 페이지 꼬리의 빈 줄을 다듬지 않는다. 각 단위의 span 은 다음 heading 까지의 연속된
//    원문 줄이므로, 그대로 이어 붙이면 원문이 바이트 그대로 복원된다. 마지막 단위의 후행
//    빈 줄을 지우면 그 성질이 깨지고 역조립 게이트가 근사 비교로 약해진다.

const anchorIndex = buildAnchorIndex();
const linkProblems = [];
const written = [];

for (const p of plan()) {
  const body = [];
  if (p.preamble) body.push(...preambleBody(p.preamble.src));

  if (p.synthetic) {
    body.length = 0;
    body.push(...indexBody(preambleBody("docs/user-guide.md")));
  } else if (p.wholeDoc) {
    const lines = readSource(p.src);
    body.push(...lines.slice(lines.findIndex((l) => /^#{2,3}\s/.test(l))));
  } else {
    for (const { shift, unit } of p.parts) {
      const lines = readSource(p.src).slice(unit.line - 1, unit.line - 1 + unit.span);
      if (shift === "drop") body.push(...lines.slice(1)); // heading 줄만 버리고 본문 유지
      else body.push(...reheading(lines, shift));
    }
  }

  const { body: linked, problems } = p.src
    ? rewriteLinks(body.join("\n"), {
        base: ROUTES.base.replace(/\/$/, ""),
        index: anchorIndex,
        slug: p.slug,
        src: p.src,
      })
    : { body: body.join("\n"), problems: [] };
  linkProblems.push(...problems);

  const out = join(OUT, `${p.slug}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${frontmatter(p.title)}\n${linked}`);
  written.push({ absorbed: p.absorbed, lines: body.length, slug: p.slug });
}

console.log(`페이지 ${written.length}개 작성 → site/src/content/docs/en/docs/`);
console.log(`heading 흡수: ${written.filter((w) => w.absorbed).length}개`);
const big = written.filter((w) => w.lines > 200);
if (big.length) console.log(`⚠️ 200줄 초과: ${big.map((w) => `${w.slug}(${w.lines})`).join(", ")}`);
if (linkProblems.length) {
  console.log(`\n❌ 링크 ${linkProblems.length}건`);
  for (const l of linkProblems) console.log("  " + l);
  process.exitCode = 1;
}
