#!/usr/bin/env node
// 분할이 손실 없음을 **증명**한다 (**이주 전용**). `npm run check:roundtrip`
//
// 생성된 페이지들에서 원문을 다시 조립해 바이트 동일성을 단정한다. 기대값은
// "원문 − 명시적으로 버린 부분" 이고, 링크 목적지 외의 어떤 차이도 손실이다.
//
// ‼️ **이 게이트가 증명하지 못하는 것**: 버림 선언이 옳은지는 판정할 수 없다. 매니페스트가
//    "버린다" 고 하면 기대·실제 양쪽이 함께 생략해 일치하므로, 배정을 버림으로 바꾸는
//    뮤테이션은 이 게이트도 통과한다(`check-ia.mjs` 도 개수가 같아 통과한다 — 실측 확인).
//    그래서 버려지는 줄을 **전부 출력**한다. 옳고 그름은 사람이 본다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DROPPED, PREAMBLES } from "../../ia-tree.mjs";
import { parseHeadings } from "./ia-measure.mjs";
import { plan, readSource, reheading } from "./split-plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = join(HERE, "..", "..", "src/content/docs/en/docs");

const problems = [];
let maskedLinks = 0;

/**
 * 링크 **목적지**만 비교에서 제외한다. 분할하면 앵커가 페이지 간 링크로 승격되므로
 * 목적지는 의도적으로 바뀐다 — 라벨과 그 밖의 모든 본문은 바이트 그대로 대조된다.
 * 목적지가 실제로 해소되는지는 빌드의 `starlight-links-validator` 가 증명한다.
 */
function maskLinkTargets(lines) {
  return lines.map((l) =>
    l.replace(/\]\(([^)]*)\)/g, (whole, target) => {
      if (/^https?:|^mailto:/.test(target)) return whole; // 외부 링크는 건드리지 않았다
      maskedLinks += 1;
      return "](·)";
    }),
  );
}

/** 생성된 페이지의 프론트매터를 떼고 본문 줄만 돌려준다. */
function pageBody(slug) {
  const raw = readFileSync(join(PAGE_DIR, `${slug}.md`), "utf8");
  const m = /^---\n[\s\S]*?\n---\n\n?/.exec(raw);
  if (!m) throw new Error(`${slug}.md 에 프론트매터가 없다`);
  return raw.slice(m[0].length).split("\n");
}

/** @type {Map<string, Map<number, string[]>>} src → (원문 줄번호 → 복원된 줄들) */
const restored = new Map();
/** @type {Map<string, string[]>} src → 복원된 머리말 */
const restoredPreamble = new Map();
/** @type {Map<string, string[]>} src → 문서 통째 페이지의 머리말 이후 본문 */
const restoredWhole = new Map();

for (const p of plan()) {
  // 문서 홈은 원문 대응물이 없지만, 머리말을 가져갔다면 그 부분은 검증 대상이다.
  if (p.synthetic && !p.preamble) continue;
  const body = pageBody(p.slug);
  let cursor = 0;

  if (p.preamble) {
    const original = readSource(p.preamble.src);
    const preLen = parseHeadings(p.preamble.src)[0].line - 1;
    const take = preLen - 1; // 분할기가 H1 줄을 뺐으므로 되돌려 놓는다
    restoredPreamble.set(p.preamble.src, [original[0], ...body.slice(cursor, cursor + take)]);
    cursor += take;
  }

  // 합성 페이지는 머리말 뒤가 생성물(그룹 목록)이므로 단위 대조 대상이 아니다.
  if (p.synthetic) continue;
  if (p.wholeDoc) {
    // ‼️ 기대·실제 양쪽에 원문을 넣으면 아무것도 단정하지 않는다 — 페이지에서 읽는다.
    restoredWhole.set(p.src, body.slice(cursor));
    continue;
  }

  const map = restored.get(p.src) ?? new Map();
  for (const { shift, unit } of p.parts) {
    const len = shift === "drop" ? unit.span - 1 : unit.span;
    const slice = body.slice(cursor, cursor + len);
    cursor += len;
    if (slice.length !== len) {
      problems.push(`[길이 부족] ${p.slug} 의 "${unit.text}" — ${slice.length}/${len}줄`);
      continue;
    }
    map.set(
      unit.line,
      shift === "drop"
        ? [`## ${unit.raw}`, ...slice] // 흡수한 heading 을 원문 그대로 되살린다
        : reheading(slice, shift === 0 ? 0 : 1),
    );
  }
  restored.set(p.src, map);

  if (cursor !== body.length) {
    problems.push(`[잔여] ${p.slug} 에 배정되지 않은 ${body.length - cursor}줄이 남았다`);
  }
}

const droppedKey = new Set(DROPPED.map((d) => `${d.src} ${d.level} ${d.text}`));

for (const src of new Set([
  ...restored.keys(),
  ...restoredPreamble.keys(),
  ...restoredWhole.keys(),
])) {
  const original = readSource(src);
  const units = parseHeadings(src);
  const preDecl = PREAMBLES.find((d) => d.src === src);
  const preLen = units[0].line - 1;

  const expected = [];
  const actual = [];

  if (preDecl && !preDecl.drop) {
    expected.push(...original.slice(0, preLen));
    actual.push(...(restoredPreamble.get(src) ?? []));
  }

  const whole = restoredWhole.get(src);
  if (whole) {
    expected.push(...original.slice(preLen));
    actual.push(...whole);
  } else {
    for (const u of units) {
      if (droppedKey.has(`${src} ${u.level} ${u.text}`)) continue;
      expected.push(...original.slice(u.line - 1, u.line - 1 + u.span));
      actual.push(...(restored.get(src)?.get(u.line) ?? [`<<MISSING: ${u.text}>>`]));
    }
  }

  const me = maskLinkTargets(expected);
  const ma = maskLinkTargets(actual);
  if (me.join("\n") === ma.join("\n")) {
    console.log(`✅ ${src} — ${expected.length}줄 바이트 동일`);
    continue;
  }
  const i = me.findIndex((l, k) => l !== ma[k]);
  problems.push(
    `[불일치] ${src} 첫 차이 ${i + 1}번째 줄\n` +
      `    기대: ${JSON.stringify(me[i])}\n` +
      `    실제: ${JSON.stringify(ma[i])}\n` +
      `    (기대 ${me.length}줄 / 실제 ${ma.length}줄)`,
  );
}

console.log(
  `\n내부 링크 목적지 ${maskedLinks / 2}개는 비교에서 제외 — 정합성은 links-validator 가 본다`,
);

// 버려지는 내용을 드러낸다. 어떤 게이트도 "버려도 되는가" 를 판정할 수 없으므로 보여준다.
console.log("\n--- 의도적으로 버리는 내용 ---");
for (const d of DROPPED) {
  const u = parseHeadings(d.src).find((x) => x.level === d.level && x.text === d.text);
  console.log(`  [절] ${d.src} "${d.text}" ${u?.span ?? "?"}줄`);
}
for (const d of PREAMBLES.filter((x) => x.drop)) {
  const body = readSource(d.src).slice(0, parseHeadings(d.src)[0].line - 1);
  console.log(`  [머리말] ${d.src} ${body.length}줄 — ${d.why}`);
  for (const l of body) if (l.trim() !== "") console.log(`      ${l}`);
}

console.log();
if (!problems.length) {
  console.log("✅ 역조립 바이트 동일 — 매니페스트가 지키라 한 모든 줄이 복원된다");
} else {
  console.log(`❌ ${problems.length}건`);
  for (const p of problems) console.log("  " + p);
}
process.exitCode = problems.length ? 1 : 0;
