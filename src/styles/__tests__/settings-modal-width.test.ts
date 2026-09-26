// §356 설정 창 폭 — 외관 탭 갤러리의 미리보기를 넓히려고 720px 고정에서 880px 로 넓혔다.
//
// 고정 px 로 두면 안 되는 이유: 앱 창의 최소 폭(`src-tauri/tauri.conf.json` 의 `minWidth`)이
// 그보다 좁다. 720px 고정이던 때도 640px 창에서 설정 창이 넘쳤다. 그래서 폭은 창 폭에
// 묶는다 — `min(880px, calc(100vw - …))`.
//
// jsdom 은 레이아웃을 계산하지 않으므로 선언을 묻는다(`font-browser-scroll.test.ts` 와 같은
// 방식).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

function declared(selector: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const rule of cssRules().filter((r) => r.selector === selector)) {
    for (const declaration of cssDeclarations(rule.body)) {
      if (declaration.prop === prop) found = declaration.value;
    }
  }
  return found;
}

describe("settings modal width", () => {
  // 무엇이 이것을 실패시키는가: 폭을 다시 고정 px 로 적으면 — 그 값이 창의 최소 폭보다
  // 크면 설정 창이 창 밖으로 넘친다.
  it("창 폭에 묶인다", () => {
    expect(declared(".settings-modal", "width")).toMatch(
      /^min\(880px, calc\(100vw - \d+px\)\)$/u,
    );
  });

  // 위 테스트의 전제 — 앱 창이 실제로 880px 보다 좁아질 수 있다.
  it("앱 창의 최소 폭은 880px 보다 좁다", () => {
    const conf = JSON.parse(
      readFileSync("src-tauri/tauri.conf.json", "utf8"),
    ) as { app: { windows: { minWidth: number }[] } };
    expect(conf.app.windows[0]?.minWidth).toBeLessThan(880);
  });
});
