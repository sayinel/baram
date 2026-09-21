import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sidebar width wiring", () => {
  it("has a CSS consumer for --sidebar-width", () => {
    // 무엇이 이것을 실패시키는가: 선언만 있고 소비자가 없으면 이 토큰은 다시
    // 죽는다 — 그것이 이 태스크 이전의 상태다. 소스 스캔인 이유는, 렌더링
    // 테스트로는 "인라인 대신 변수를 쓴다" 는 성질을 구분할 수 없기 때문이다.
    const css = readFileSync(
      path.join(process.cwd(), "src/styles/layout.css"),
      "utf8",
    );
    expect(css).toContain("var(--sidebar-width");
  });

  it("no longer sets the sidebar width through an inline style", () => {
    const tsx = readFileSync(
      path.join(process.cwd(), "src/components/layout/AppLayout.tsx"),
      "utf8",
    );
    expect(tsx).not.toContain("width: `${sidebarWidth}px`");
  });
});
