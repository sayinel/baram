// §349 — 두 폰트 변수가 UI 크롬으로 새지 않는지.
//
// 이 가드가 지키는 주장: 코드 서체 설정은 코드 블록·수식·표를 바꾸고 파일 트리
// 경로·git 해시·상태바는 건드리지 않는다. 변수를 :root 에 덮는 구현으로
// 되돌아가면 이 파일이 실패한다.
//
// 실측 (2026-09-10, 주석 제거 후 `cssRules()` 로 센 값):
//   var(--font-family-mono)  30개  in src/styles/editor/**  = 문서
//   var(--font-family-mono)  61개  in 그 밖의 스타일시트     = 크롬
// (`src/styles/*.css` 한 층만 세면 52개다 — 계획서가 인용한 숫자가 그것이다.)
import { readFileSync } from "node:fs";
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

describe("§349 font variable scope", () => {
  // documentElement / :root 에 이 변수를 setProperty 하는 코드가 없어야 한다.
  it("never sets the font variables on the document root", () => {
    const suspects = [
      "src/components/editor/SourceCodeEditor.tsx",
      "src/components/journal/use-capture-editor.ts",
      "src/hooks/use-settings-effects.ts",
      "src/utils/editor/font-surfaces.ts",
    ];
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
