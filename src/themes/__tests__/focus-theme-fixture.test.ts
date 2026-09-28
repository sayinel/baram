// §371 — 크롬 제안 테스트 둘(`stores/ui/__tests__/chrome-proposal.test.ts`,
// `hooks/__tests__/use-settings-effects-theme-chrome.test.tsx`)이 읽는 픽스처를 이
// 파일이 지킨다.
//
// 두 테스트는 손으로 적은 매니페스트 대신 이 픽스처를 **실제 관문**
// (`validateThemeManifest`)에 통과시켜 얻는다 — 그래야 `chrome`이 조용히 버려지는
// 결함(`theme-manifest.ts`의 `validateChrome`은 모르는 키를 버리는 태도다)이 두 테스트
// 에서 무증상이 되지 않는다. 이 파일이 픽스처 자신을 시험하는 이유는, 픽스처가 오타로
// `chrome`을 잃으면(예: 표면 이름 오타) 그 두 테스트가 조용히 공허해지기 때문이다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateThemeManifest } from "../theme-manifest";

const SOURCE = resolve(__dirname, "fixtures/focus-theme.json");
const raw = JSON.parse(readFileSync(SOURCE, "utf8")) as unknown;

describe("크롬 제안 픽스처", () => {
  it("실제 매니페스트 관문을 통과한다", () => {
    expect(validateThemeManifest(raw).valid).toBe(true);
  });

  it("선언한 chrome 이 하나도 버려지지 않는다", () => {
    const declared = (raw as { chrome: Record<string, unknown> }).chrome;
    const result = validateThemeManifest(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.chrome).toEqual(declared);
  });

  it("세 표면을 모두 감출 것을 제안한다", () => {
    const result = validateThemeManifest(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.chrome).toEqual({
      activityBar: false,
      statusBar: false,
      tabBar: false,
    });
  });
});
