import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sidebar width wiring", () => {
  it("has a CSS consumer for --sidebar-width", () => {
    // 무엇이 이것을 실패시키는가: 선언만 있고 소비자가 없으면 이 토큰은 다시
    // 죽는다 — 그것이 이 태스크 이전의 상태다. 소스 스캔인 이유는 구분
    // 불가능이 아니다 — jsdom 은 `el.style.width === ""` 와
    // `el.style.getPropertyValue("--sidebar-width") === "260px"` 를 정확히
    // 구분한다. 진짜 이유는 비용이다: `AppLayout` 의 트리를 렌더링해야
    // 하는 값보다, 두 파일을 읽는 이 스캔이 훨씬 싸다.
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
