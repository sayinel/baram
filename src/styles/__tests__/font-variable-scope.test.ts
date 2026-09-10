// §349 — 두 폰트 변수가 UI 크롬으로 새지 않는지.
//
// 이 가드가 지키는 주장: 코드 서체 설정은 코드 블록·수식·표를 바꾸고 파일 트리
// 경로·git 해시·상태바는 건드리지 않는다.
//
// ‼️ 이 파일이 지키는 것과 지키지 못하는 것을 구분해 둔다(리뷰 Important 2).
// 아래 소스 스캔은 `document.documentElement.style.setProperty("--font-family-…")`
// 라는 **철자**를 찾는다. `applyFontVariables(document.documentElement, …)` 는
// 같은 누수를 만들면서 이 철자에 걸리지 않으므로, 그 경로는 함수 안의 런타임
// 가드가 막는다(`utils/editor/font-surfaces.ts`, 테스트는
// `utils/editor/__tests__/font-surfaces.test.ts` 의 "refuses to write … to
// documentElement"). 즉 :root 회귀 방어의 본체는 그 throw 이고, 이 스캔은 값싼
// 두 번째 그물이다.
//
// 아래 문서/크롬 개수는 **파일 경로** 분할이고 DOM 포함관계가 아니다 — 그 차이가
// 리뷰 Important 1 이었고, 그쪽은 `font-surface-containment.test.ts` 가 맡는다.
//
// 실측 (2026-09-10, 주석 제거 후 `cssRules()` 로 센 값):
//   var(--font-family-mono)  30개  in src/styles/editor/**  = 문서(파일 경로 기준)
//   var(--font-family-mono)  61개  in 그 밖의 스타일시트     = 크롬
// (`src/styles/*.css` 한 층만 세면 52개다 — 계획서가 인용한 숫자가 그것이다.)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cssRules } from "./css-rules";

/** 문서 표면 스타일시트 — 표면에 덮은 변수가 상속으로 닿는 곳. */
const DOCUMENT_DIR = `${path.sep}styles${path.sep}editor${path.sep}`;

/** 사용자가 "코드 서체"를 바꿔도 변해서는 안 되는 크롬 — 주장이 지목하는 표면. */
const CHROME_SURFACES = ["file-tree.css", "git.css", "layout.css"];

/** 규칙 본문마다 이 변수를 몇 번 읽는지. 주석은 `cssRules()` 가 이미 제거했다. */
const monoReads = (body: string): number =>
  [...body.matchAll(/var\(--font-family-mono\)/gu)].length;

const sourceOf = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

/** `font-surfaces` 를 import 하는 모든 소스 파일 (테스트 제외), 저장소 상대 경로. */
function fontSurfaceImporters(): string[] {
  const root = process.cwd();
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name)) continue;
      if (/\.test\.tsx?$/u.test(entry.name)) continue;
      const src = readFileSync(full, "utf8");
      if (!/from\s+["'][^"']*editor\/font-surfaces["']/u.test(src)) continue;
      found.push(path.relative(root, full));
    }
  };
  walk(path.join(root, "src"));
  return found.sort();
}

describe("§349 font variable scope", () => {
  // documentElement / :root 에 이 변수를 setProperty 하는 코드가 없어야 한다.
  //
  // ‼️ 용의자 목록을 손으로 적지 않는다. 손으로 적은 네 경로는 Task 7 이 더할
  // 다섯 번째 호출부(`export-html.ts`)를 담지 못하고, 목록을 늘리라고 강제하는
  // 것도 없었다. 폰트 표면 모듈을 import 하는 파일 전부에서 파생시키면 새
  // 호출부가 생기는 순간 자동으로 감시 대상이 된다.
  it("never sets the font variables on the document root", () => {
    const suspects = fontSurfaceImporters();
    // 파생이 빈 목록을 내면 이 테스트는 공허하다 — 배선된 호출부가 실제로 있다.
    expect(suspects.length).toBeGreaterThanOrEqual(4);
    for (const rel of suspects) {
      const src = sourceOf(rel);
      const rootWrites = [
        ...src.matchAll(
          /document\.documentElement\.style\.setProperty\(\s*["'](--font-family-[a-z]+)["']/gu,
        ),
      ].map((m) => m[1]);
      expect(rootWrites, `${rel} writes font vars to :root`).toEqual([]);
    }
  });

  // 루트에 덮지 않는 이유 그 자체를 고정한다. 크롬 쪽 소비자가 문서 쪽보다
  // 많으므로, :root 구현의 피해 범위가 이득 범위보다 넓다.
  it("has more chrome consumers of the mono token than document ones", () => {
    let document = 0;
    let chrome = 0;
    for (const rule of cssRules()) {
      const n = monoReads(rule.body);
      if (rule.file.includes(DOCUMENT_DIR)) document += n;
      else chrome += n;
    }
    expect(
      document,
      "no document consumer left — guard is vacuous",
    ).toBeGreaterThan(0);
    expect(
      chrome,
      `chrome ${chrome} vs document ${document}: the :root rationale no longer holds`,
    ).toBeGreaterThan(document);
  });

  // 주장이 이름으로 지목하는 크롬 표면들이 여전히 토큰 값을 읽는다. 여기가 0이
  // 되면 누군가 그 크롬을 문서 표면 안으로 옮긴 것이다 — 의도라면 근거와 함께
  // 이 목록에서 뺀다.
  it.each(CHROME_SURFACES)("keeps %s reading the token value", (file) => {
    const reads = cssRules()
      .filter((r) => r.file.endsWith(`${path.sep}${file}`))
      .reduce((sum, r) => sum + monoReads(r.body), 0);
    expect(reads).toBeGreaterThan(0);
  });
});
