// src/utils/export/__tests__/export-font-embed.test.ts
// §353 — export 에 사용자 서체를 싣는다.
//
// 왜 빌드 시점 ?inline 이 아닌가: export-katex-fonts.ts 가 그 방식으로 20개
// KaTeX face(≈296KB → 395KB base64)를 export 청크에 넣는다. 2MB 서체를 같은
// 방식으로 넣으면 체크박스를 끄든 켜든 2.7MB 가 청크에 상주하고, export
// 다이얼로그를 여는 것만으로 로드된다. ?url + fetch 는 필요할 때만 비용이 든다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_FONTS } from "../../font/bundled-fonts";
import { buildFontFaceCSS, exportFontVariables } from "../export-font-embed";

describe("exportFontVariables", () => {
  it("names both variables with the user families first", () => {
    const css = exportFontVariables("Noto Sans KR", "D2Coding");
    expect(css).toContain('--font-family-editor:"Noto Sans KR"');
    expect(css).toContain('--font-family-mono:"D2Coding"');
  });

  it("omits a variable whose setting is empty so the stylesheet default stands", () => {
    const css = exportFontVariables("", "D2Coding");
    expect(css).not.toContain("--font-family-editor");
    expect(css).toContain("--font-family-mono");
  });

  it("quotes a digit-leading family", () => {
    expect(exportFontVariables("Source Sans 3", "")).toContain(
      '"Source Sans 3"',
    );
  });
});

describe("buildFontFaceCSS", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        ok: true,
      })),
    );
  });

  it("embeds a bundled family as a data URI", async () => {
    const css = await buildFontFaceCSS(["Pretendard Variable"]);
    expect(css).toContain("@font-face");
    expect(css).toContain('font-family:"Pretendard Variable"');
    expect(css).toContain("url(data:font/woff2;base64,");
  });

  // 시스템 서체는 재배포 허용 여부를 알 수 없다 — 이름만 실린다.
  it("embeds nothing for a family the app does not bundle", async () => {
    const css = await buildFontFaceCSS(["Noto Sans KR"]);
    expect(css).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("embeds each requested bundled family once", async () => {
    const css = await buildFontFaceCSS([
      "Pretendard Variable",
      "Pretendard Variable",
      "JetBrains Mono Variable",
    ]);
    expect([...css.matchAll(/@font-face/gu)]).toHaveLength(2);
  });

  // 네트워크가 아니라 로컬 자산이지만 실패는 가능하다. 그때 export 를 죽이지
  // 않는다 — 서체 없는 문서가 없는 문서보다 낫다.
  it("returns an empty string when the asset cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await expect(buildFontFaceCSS(["Pretendard Variable"])).resolves.toBe("");
  });
});

// §353 리뷰 Important 1 — `family`/`weightRange`는 이제 BUNDLED_FONTS에서 끌어오지만,
// `?url` import 경로는 Vite가 정적 문자열을 요구해서 여전히 손으로 적혀 있다. 그
// 잔여 중복이 갈라지면(예: bundled-fonts.ts에서 파일명을 바꾸고 이 파일의 import는
// 안 바꾸면) buildFontFaceCSS는 그 서체를 조용히 건너뛴다 — 이 테스트가 없으면
// 아무 게이트도 못 잡는다. 소스 텍스트를 스캔하는 이유: 런타임 딕셔너리
// (ASSET_URLS)의 키만 비교하면 값(실제 import된 URL)이 엉뚱한 파일을 가리켜도
// 통과한다 — import 문 자체의 경로 리터럴을 읽어야 진짜 배선을 본다.
describe("§353 review Important 1 — the residual ?url import duplication stays pinned", () => {
  it("imports exactly the asset files BUNDLED_FONTS names, no more, no fewer", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/utils/export/export-font-embed.ts"),
      "utf8",
    );
    const importedBasenames = [...source.matchAll(/from\s+"([^"]+)\?url"/gu)]
      .map((m) => path.posix.basename(m[1]))
      .sort();
    const declaredFileNames = BUNDLED_FONTS.map((f) => f.fileName).sort();
    expect(importedBasenames).toEqual(declaredFileNames);
  });
});
