// IA 트리를 원문 heading 실측과 대조하는 공유 코어 (**이주 전용**).
// 소비자: check-ia.mjs(게이트) · gen-ia-doc.mjs(문서 생성) · split-plan.mjs(분할 계획).
// 판정이 갈리지 않게 한 곳에 둔다.
//
// 배정 단위 = 모든 H2 + 모든 H3. H3를 가진 H2의 단위는 그 "도입부"(H2 줄 ~ 첫 H3)다.
// ‼️ 도입부를 단위에서 빼면 그 줄들이 아무 페이지에도 배정되지 않고 합계가 조용히
//    과소 계상된다 — 초기 판에서 실제로 239줄이 사라졌고, '파일 소진' 대조만이 그걸 잡았다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DROPPED, GROUPS, groupOf, PAGES, PREAMBLES, TITLES } from "../../ia-tree.mjs";

/** 원문 경로는 리포 루트 기준이다 — cwd에 의존하면 npm script와 직접 실행이 갈린다. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const FLOOR = 40;
export const CEIL = 200;
const SEP = " ";

/** 파일의 `split("\n")` 세그먼트 수. span 계산과 같은 단위여야 소진 산술이 성립한다. */
export function segmentCount(path) {
  return readFileSync(join(ROOT, path), "utf8").split("\n").length;
}

/** 코드 펜스를 추적해 H2/H3를 뽑는다 — 펜스 안의 `## Captures` 같은 예시를 헛세면 안 된다. */
export function parseHeadings(path) {
  const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
  let inFence = false;
  const hits = [];
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    // `text` 는 대조·표시용으로 백틱을 지운 값, `raw` 는 원문 그대로다.
    // ‼️ raw 가 없으면 흡수한 heading 을 되살릴 때 백틱이 사라져 역조립이 어긋난다
    //    (`## Manifest (\`baram-plugin.json\`)` 에서 실제로 어긋났다).
    if (m) hits.push({ level: m[1].length, line: i + 1, raw: m[2], text: m[2].replace(/`/g, "") });
  });
  let h2 = null;
  return hits.map((h, i) => {
    if (h.level === 2) h2 = h.text;
    return {
      ...h,
      parent: h.level === 2 ? null : h2,
      span: (hits[i + 1]?.line ?? lines.length + 1) - h.line,
    };
  });
}

const key = (src, u) => [src, u.level, u.parent ?? "", u.text].join(SEP);

/**
 * 매니페스트 항목 하나가 가리키는 단위를 찾는다.
 * 문법: {h2:"Name"} = H2 도입부 · "Parent > Child" = 한정 H3 · "Child" = 비한정
 */
function resolve(units, entry) {
  if (typeof entry === "object") {
    return { label: `H2:${entry.h2}`, hit: units.filter((u) => u.level === 2 && u.text === entry.h2) };
  }
  if (entry.includes(" > ")) {
    const [parent, child] = entry.split(" > ");
    return {
      label: entry,
      hit: units.filter((u) => u.level === 3 && u.parent === parent && u.text === child),
    };
  }
  return { label: entry, hit: units.filter((u) => u.text === entry) };
}

export function measure() {
  const docs = new Map();
  for (const src of new Set(PAGES.filter((p) => p.src).map((p) => p.src))) {
    docs.set(src, parseHeadings(src));
  }

  const claims = new Map();
  const problems = [];
  const pages = [];

  for (const page of PAGES) {
    const base = { ...page, group: groupOf(page.slug), title: TITLES[page.slug] };
    if (page.synthetic) { pages.push({ ...base, lines: null, units: [] }); continue; }
    const units = docs.get(page.src);
    const mine = [];
    const take = (u) => {
      const k = key(page.src, u);
      claims.set(k, [...(claims.get(k) ?? []), page.slug]);
      mine.push(u);
    };

    if (page.wholeDoc) {
      units.forEach(take);
    } else if (page.h2) {
      for (const name of page.h2) {
        const hit = units.filter((u) => (u.level === 2 && u.text === name) || u.parent === name);
        if (!hit.length) problems.push(`[미해결 H2] ${page.slug}: "${name}" (${page.src})`);
        hit.forEach(take);
      }
    } else {
      for (const entry of page.items) {
        const { label, hit } = resolve(units, entry);
        if (!hit.length) { problems.push(`[미해결] ${page.slug}: "${label}" (${page.src})`); continue; }
        if (hit.length > 1) {
          problems.push(
            `[모호] ${page.slug}: "${label}" — ${hit.length}곳 (부모: ${hit.map((h) => h.parent ?? "H2").join(" / ")}). "부모 > 자식"으로 한정할 것`,
          );
          continue;
        }
        take(hit[0]);
      }
    }
    pages.push({ ...base, lines: mine.reduce((a, u) => a + u.span, 0), units: mine });
  }

  for (const [k, slugs] of claims) {
    if (slugs.length > 1) {
      const [src, , parent, text] = k.split(SEP);
      problems.push(`[중복] "${text}" (${parent || "H2"} · ${src}) ← ${slugs.join(", ")}`);
    }
  }

  const dropped = new Set(DROPPED.map((d) => [d.src, d.level, "", d.text].join(SEP)));
  let droppedLines = 0;
  let sourceLines = 0;
  for (const [src, units] of docs) {
    for (const u of units) {
      sourceLines += u.span;
      const k = key(src, u);
      if (dropped.has(k)) { droppedLines += u.span; continue; }
      if (!claims.has(k)) {
        problems.push(`[누락] "${u.text}" (${u.parent ?? "H2"} · ${src}, ${u.span}줄)`);
      }
    }
  }

  // 머리말 회계 — 첫 H2 앞의 줄들은 어떤 단위에도 속하지 않는다.
  let preambleAssigned = 0;
  let preambleDropped = 0;
  let fileSegments = 0;
  for (const [src, units] of docs) {
    fileSegments += segmentCount(src);
    const pre = units[0] ? units[0].line - 1 : segmentCount(src);
    const decl = PREAMBLES.find((d) => d.src === src);
    if (!decl) { problems.push(`[머리말 미선언] ${src} 의 앞 ${pre}줄이 배정되지 않았다`); continue; }
    if (decl.drop) { preambleDropped += pre; continue; }
    if (!pages.some((p) => p.slug === decl.to)) {
      problems.push(`[머리말 배정 오류] ${src} → "${decl.to}" 그런 페이지가 없다`);
      continue;
    }
    preambleAssigned += pre;
  }
  for (const d of PREAMBLES) {
    if (!docs.has(d.src)) problems.push(`[고아 머리말 선언] ${d.src} — PAGES 가 읽지 않는 문서다`);
  }

  for (const p of pages) {
    if (p.lines === null || p.wholeDoc) continue;
    if (p.lines < FLOOR && !p.floorException) problems.push(`[하한] ${p.slug}: ${p.lines}줄 < ${FLOOR}`);
    if (p.lines >= FLOOR && p.floorException) {
      problems.push(`[불필요한 예외] ${p.slug}: ${p.lines}줄 — 예외 표시를 지울 것`);
    }
    if (p.lines > CEIL) problems.push(`[상한] ${p.slug}: ${p.lines}줄 > ${CEIL}`);
  }

  // 제목: Starlight 이 title 프론트매터를 요구하므로 하나라도 빠지면 빌드가 죽는다.
  for (const p of pages) {
    if (!TITLES[p.slug]) problems.push(`[제목 없음] ${p.slug} — TITLES 에 등록할 것`);
  }
  for (const slug of Object.keys(TITLES)) {
    if (!pages.some((p) => p.slug === slug)) problems.push(`[고아 제목] TITLES["${slug}"] — 그런 페이지가 없다`);
  }

  // 접두어 오타는 단독 페이지로 조용히 강등된다. 죽은 그룹은 다음 사람을 오해시킨다.
  for (const p of pages) {
    if (p.slug.includes("/") && p.group === null) {
      problems.push(`[미등록 그룹] ${p.slug} — 접두어가 GROUPS에 없다`);
    }
  }
  for (const k of Object.keys(GROUPS)) {
    if (!pages.some((p) => p.group === k)) problems.push(`[죽은 그룹] GROUPS.${k} — 쓰는 페이지가 없다`);
  }

  const assignedLines = pages.reduce((a, p) => a + (p.lines ?? 0), 0);
  const sized = pages.filter((p) => p.lines !== null && !p.wholeDoc);

  return {
    pages,
    problems,
    stats: {
      assignedLines,
      avg: Math.round(sized.reduce((a, p) => a + p.lines, 0) / sized.length),
      droppedLines,
      exhausted: assignedLines + droppedLines === sourceLines,
      fileCount: pages.length * 2,
      fileExhausted:
        assignedLines + droppedLines + preambleAssigned + preambleDropped === fileSegments,
      fileSegments,
      groups: Object.keys(GROUPS),
      pageCount: pages.length,
      preambleAssigned,
      preambleDropped,
      sizedCount: sized.length,
      sourceLines,
      standalone: pages.filter((p) => p.group === null).length,
    },
  };
}
