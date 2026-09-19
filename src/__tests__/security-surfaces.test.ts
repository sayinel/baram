// 테마 CSS가 닿으면 안 되는 화면의 목록을, 사람이 고른 목록이 아니라 **효과**로 고정한다.
//
// 판정: 동의·승인·회수 IPC를 호출하거나 회수 사실을 고지하는 컴포넌트.
// 새 화면이 그 부류에 들어오면 이 테스트가 먼저 빨개진다 — 목록에 넣는 것을
// 잊어서 테마가 가릴 수 있게 되는 일을 막는다.
// ‼️ `fast-glob` 을 쓰지 말 것 — 이 리포에 직접 의존성으로 없고 stylelint 의 전이
// 의존일 뿐이라, hoisting 에 기대는 import 가 된다. 이 리포의 관용구는
// `readdirSync` 재귀다 (`src/__tests__/bare-store-lint-rule.test.ts:33`,
// `no-local-storage.test.ts`, `bootstrap-order.test.ts` 가 모두 같은 모양).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import { SECURITY_SURFACE_FILES } from "../components/ui/security-surfaces";

/** `bare-store-lint-rule.test.ts` 의 순회를 그대로 쓴다. */
function tsxFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.posix.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") tsxFilesUnder(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 이 중 하나라도 부르면 보안 표면이다.
 *
 * ‼️ 통제자가 실행 전에 전수 스캔으로 확정했다. 이 집합이 정확히 세 파일을 낸다:
 * PluginConsentDialog.tsx · PluginRevokedNotice.tsx · ApprovedRootsSection.tsx.
 *
 * `consentCovers` 가 핵심이다 — 처음에 쓴 목록은 `consentRequired`·`consentGaps`·
 * `grantableCapabilities` 였는데, **동의 대화상자는 그중 아무것도 부르지 않는다**
 * (능력 목록을 props 로 받는다). 가장 중요한 표면을 놓치는 목록이었다.
 *
 * 일부러 뺀 것 둘, 이유와 함께:
 *  - `pickApprovedDir` — 소비자가 7개인데 전부 네이티브 폴더 선택 대화상자를 연다.
 *    OS 가 그리는 창이라 CSS 로 위장할 수 없고, FileTree·TasksTab 같은 평범한 화면을
 *    shadow DOM 으로 밀어 넣게 된다.
 *  - `revocationFor` — PluginMarketplace·PluginDetailTab 이 쓴다. 회수 **상태 배지**이고,
 *    설치 차단은 코드가 한다. 마켓플레이스 본문은 테마가 칠할 수 있어야 하는 화면이다.
 *    회수 **고지** 자체는 PluginRevokedNotice 로 따로 격리된다.
 */
const EFFECTS = [
  "consentCovers",
  "listApprovedRoots",
  "revocationReason",
  "revokeApprovedRoot",
];

it("효과로 찾은 표면 집합과 선언된 목록이 정확히 일치한다", () => {
  const files = tsxFilesUnder("src/components");
  const found = files.filter((f) => {
    const src = readFileSync(f, "utf-8");
    return EFFECTS.some((e) => src.includes(e));
  });
  expect([...found].sort()).toEqual([...SECURITY_SURFACE_FILES].sort());
});
