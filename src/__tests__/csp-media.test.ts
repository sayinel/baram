// §298 CSP 미디어 소스 가드.
//
// ‼️ 이 결합은 개발 중에 검증되지 않는다. Tauri는 패키지 빌드에서만 전역 csp를 응답
// 헤더로 붙이고, dev는 Vite 개발 서버를 로드해 헤더가 없다. 같은 함정이
// plugins-enabled.csp.test.ts의 주석에 기록돼 있다(sandbox가 blob:을 필요로 하는데
// 전역에 없던 시기가 dev-gate 덕에 살아남았던 사건). 그래서 릴리스에서만 깨진다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

/** `media-src 'self' asset:` → ["'self'", "asset:"] */
function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return found ? found.slice(name.length).trim().split(/\s+/) : [];
}

function globalCsp(): string {
  const conf = JSON.parse(
    readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
  ) as { app: { security: { csp: string } } };
  return conf.app.security.csp;
}

describe("global CSP for video (§298)", () => {
  it("declares media-src at all — default-src would otherwise block <video>", () => {
    expect(directive(globalCsp(), "media-src").length).toBeGreaterThan(0);
  });

  // convertFileSrc는 플랫폼마다 다른 형태를 낸다 (tauri scripts/core.js:16–18):
  // windows/android는 http://asset.localhost, 그 외는 asset://localhost.
  // 한쪽만 넣으면 그 플랫폼에서만 조용히 막힌다.
  it("allows BOTH asset protocol spellings in media-src", () => {
    const sources = directive(globalCsp(), "media-src");
    expect(sources).toContain("asset:");
    expect(sources).toContain("http://asset.localhost");
  });

  it("allows remote video files and blob/data media in media-src", () => {
    const sources = directive(globalCsp(), "media-src");
    expect(sources).toContain("'self'");
    expect(sources).toContain("https:");
    expect(sources).toContain("blob:");
    expect(sources).toContain("data:");
  });

  it("frame-src lists exactly the two providers we construct URLs for", () => {
    const sources = directive(globalCsp(), "frame-src");
    expect(sources).toContain("https://www.youtube-nocookie.com");
    expect(sources).toContain("https://player.vimeo.com");
    // provider 화이트리스트가 https: 전체로 넓어지지 않았음을 고정한다.
    expect(sources).not.toContain("https:");
  });
});
