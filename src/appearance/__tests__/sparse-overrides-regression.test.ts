import { beforeEach, describe, expect, it } from "vitest";

import { applyDialVars, clearDialVars } from "../apply";
import { DIALS } from "../dials";
import { resolveDials } from "../merge";

describe("sparse overrides keep the cascade in charge", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("leaves the document root untouched when no layer speaks", () => {
    // 무엇이 이것을 실패시키는가: 적용기가 기본값까지 인라인으로 쓰면, 이 단언이
    // 깨진다. 그 상태에서 `system` 테마는 `prefers-color-scheme` 를 따라가지
    // 못한다 — 인라인이 미디어 쿼리를 이기기 때문이다. `theme-vars.ts` 의
    // `CASCADE_ONLY_THEME_IDS` 주석이 그 사고를 기록한다.
    applyDialVars(document.documentElement, resolveDials({}, {}));
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("touches only the variables of the dials that spoke", () => {
    applyDialVars(
      document.documentElement,
      resolveDials({}, { editorPadding: 2 }),
    );
    const written = document.documentElement.getAttribute("style") ?? "";
    const untouched = DIALS.filter((d) => d.id !== "editorPadding").flatMap(
      (d) => d.vars,
    );
    for (const name of untouched) expect(written).not.toContain(name);
  });

  it("returns the root to its untouched state after a clear", () => {
    // 긍정 단언과 짝이다 — 위의 두 부정 단언만으로는 apply 가 아무것도 안 해도
    // 통과한다. 이 테스트가 그 가설을 가른다.
    applyDialVars(
      document.documentElement,
      resolveDials({}, { editorPadding: 2, editorMaxWidth: 640 }),
    );
    expect(document.documentElement.getAttribute("style")).not.toBeNull();
    clearDialVars(document.documentElement);
    expect(document.documentElement.getAttribute("style") ?? "").toBe("");
  });
});
