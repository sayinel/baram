// 테마 CSS가 닿으면 안 되는 화면의 목록을, 사람이 고른 목록이 아니라 **효과**로 고정한다.
//
// 판정: 동의·승인·회수 IPC를 호출하거나 회수 사실을 고지하는 컴포넌트.
// 새 화면이 그 부류에 들어오면 이 테스트가 먼저 빨개진다 — 목록에 넣는 것을
// 잊어서 테마가 가릴 수 있게 되는 일을 막는다.
// ‼️ `fast-glob` 을 쓰지 말 것 — 이 리포에 직접 의존성으로 없고 stylelint 의 전이
// 의존일 뿐이라, hoisting 에 기대는 import 가 된다. 이 리포의 관용구는
// `readdirSync` 재귀다 (`src/__tests__/bare-store-lint-rule.test.ts:32`,
// `no-local-storage.test.ts`, `bootstrap-order.test.ts` 가 모두 같은 모양).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import {
  NON_RENDERING_EFFECT_CALLERS,
  SECURITY_SURFACE_FILES,
} from "../utils/security-surfaces";

// `bare-store-lint-rule.test.ts`(`walk`, :32)와 같이 `__dirname` 에 루트를 둔다
// (`no-local-storage.test.ts:23`·`bootstrap-order.test.ts:25` 도 `resolve(__dirname,
// …)`) — cwd 에 루트를 두면 vitest 실행 위치가 바뀔 때 드리프트 보고 대신 ENOENT 로
// 죽는다. `ROOT` 는 리포 루트(이 파일에서 두 단계 위)다.
const ROOT = path.resolve(__dirname, "../..");
const COMPONENTS_DIR = path.join(ROOT, "src/components");

/** `walk` 과 같은 재귀 모양이되 `.ts`까지 본다(아래 EFFECTS 코퍼스 참고). 결과는
 *  리포 루트 기준 **posix** 상대경로로 정규화한다 — 비교 대상이 문자열 키라
 *  Windows 에서 `path.sep` 이 역슬래시로 새면 키가 어긋난다(CLAUDE.md).
 *
 *  테스트 파일은 디렉터리 이름(`__tests__`)뿐 아니라 파일명으로도 뺀다 —
 *  `*.test.ts(x)`/`*.spec.ts(x)` 가 `__tests__` 밖에 놓일 수도 있어서다(오늘은
 *  `src/components` 아래에 그런 파일이 0개라 잠복 상태이지만, 디렉터리 검사만으로는
 *  막지 못한다). */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") filesUnder(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * 이 중 하나라도 부르면 보안 표면이다. 코퍼스는 `src/components` 아래 `.ts`+`.tsx`
 * 전부, `__tests__` 디렉터리는 제외한다.
 *
 * ‼️ 통제자가 실행 전에 이 코퍼스로 전수 스캔해 확정했다. 정확히 네 파일을 낸다:
 * PluginConsentDialog.tsx · PluginRevokedNotice.tsx · ApprovedRootsSection.tsx ·
 * usePluginActions.ts — 그중 그리는 셋은 `SECURITY_SURFACE_FILES`, 그리지 않는
 * 하나는 `NON_RENDERING_EFFECT_CALLERS`(둘 다 `security-surfaces.ts`)에 있다.
 *
 * `consentCovers` 가 핵심이다 — 처음에 쓴 목록은 `consentRequired`·`consentGaps`·
 * `grantableCapabilities` 였는데, **동의 대화상자는 그중 아무것도 부르지 않는다**
 * (능력 목록을 props 로 받는다). 가장 중요한 표면을 놓치는 목록이었다.
 *
 * 코퍼스가 `.tsx` 만이 아니라 `.ts` 도 보는 이유가 `usePluginActions.ts` 다: 이
 * 디렉터리의 `plugin-ui-i18n.test.tsx` 가 `.tsx` 만 스캔한다는 이유로 JSX 없는 훅을
 * `.ts` 로 갈라 둔 기존 관례가 있다(파일 자체 헤더 :17-19) — `.tsx` 로만 스캔했다면
 * `revocationReason`(:187,:333) 호출이 조용히 빠졌을 것이다.
 *
 * 넷을 부르지 않지만 같은 종류(승인을 주거나 거두는) 효과인데 일부러 뺀 것 셋,
 * 이유와 함께(코퍼스 표기는 위와 같다):
 *  - `pickApprovedDir` — 코퍼스 안 소비자 7개 파일 / 8호출지점(FileTree.tsx,
 *    TasksTab.tsx, JournalTab.tsx, ZettelkastenTab.tsx, VaultTab.tsx,
 *    PluginDeveloperSection.tsx, ContextAddMenu.tsx 는 :66·:90 두 번), 코퍼스 밖에
 *    2개 파일이 더 있다(src/hooks/use-file-operations.ts:447,
 *    src/services/vault-create.ts:11) — 전체 9파일 / 10호출지점. 전부
 *    `invoke("pick_approved_dir")`(`ipc/approval.ts:74-79`)로 네이티브 폴더 선택
 *    대화상자를 연다. OS 가 그리는 창이라 CSS 로 위장할 수 없고, FileTree·TasksTab
 *    같은 평범한 화면을 shadow DOM 으로 밀어 넣게 된다.
 *  - `pickApprovedFile` — 같은 이유로 뺀다: `invoke("pick_approved_file")`
 *    (`ipc/approval.ts:82`, "단독 파일을 고르게 하고, 그 파일을 승인한다")도 네이티브
 *    파일 선택 대화상자다. 코퍼스 안 소비자는 `ContextAddMenu.tsx:78` 하나, 코퍼스
 *    밖은 `src/hooks/use-file-operations.ts:218`.
 *  - `revocationFor` — 코퍼스 안 소비자는 PluginMarketplace.tsx(:141
 *    `shownRevocation`) · PluginDetailTab.tsx(:203) · usePluginActions.ts(:183,:329).
 *    그중 무엇도 직접 그리지 않는다: PluginMarketplace 는 결과를 불리언으로 줄여
 *    PluginBrowseList 경유 PluginCard 의 회수 배지 prop 으로 넘기고, PluginDetailTab
 *    은 계산한 RevocationEntry 를 PluginDetail 경유 PluginRevokedNotice 의 prop 으로
 *    넘기며, usePluginActions 는 그 결과로 설치를 코드에서 막는다(에러 텍스트는
 *    `revocationReason` 이 만든다 — 그래서 그 효과는 위 넷에 있다). 회수 **고지**
 *    자체는 PluginRevokedNotice 가 `revocationReason` 을 불러 그린다.
 */
const EFFECTS = [
  "consentCovers",
  "listApprovedRoots",
  "revocationReason",
  "revokeApprovedRoot",
];

it("보안 표면 목록과 그리지 않는 목록이 겹치지 않는다", () => {
  const overlap = SECURITY_SURFACE_FILES.filter((f) =>
    (NON_RENDERING_EFFECT_CALLERS as readonly string[]).includes(f),
  );
  expect(overlap).toEqual([]);
});

it("효과로 찾은 표면 집합이 선언된 두 목록의 합집합과 정확히 일치한다", () => {
  const found = filesUnder(COMPONENTS_DIR).filter((f) => {
    const src = readFileSync(path.join(ROOT, f), "utf-8");
    return EFFECTS.some((e) => src.includes(e));
  });
  const declared = [...SECURITY_SURFACE_FILES, ...NON_RENDERING_EFFECT_CALLERS];
  expect([...found].sort()).toEqual([...declared].sort());
});

// 위 두 테스트는 **멤버십**만 본다 — 스캔이 찾은 파일이 두 목록 중 정확히 하나에
// 있는지. `PluginRevokedNotice.tsx`를 `SECURITY_SURFACE_FILES`에서
// `NON_RENDERING_EFFECT_CALLERS`로 옮겨도 둘 다 그린 채로 통과한다: 여전히 스캔에
// 잡히고, 여전히 목록 하나에만 있다. 아래 두 테스트가 **분류**를 잡는다.
it("SECURITY_SURFACE_FILES 원소는 전부 .tsx 다", () => {
  for (const f of SECURITY_SURFACE_FILES) {
    expect(f.endsWith(".tsx")).toBe(true);
  }
});

// DOM_CONSTRUCTION_MARKERS 는 우리 첫 파티 소스에 대한 빌드타임 인벤토리를 문자열로
// 검사한다 — 계획의 "보안 판정은 파서로 한다" 제약은 신뢰할 수 없는 입력(예:
// `java\tscript:` 같은 우회)을 우리가 판정할 때 적용되는 것이지, 우리가 직접 읽을 수
// 있는 우리 코드의 생김새를 서술할 때는 적용되지 않는다. 과다 검출의 방향도
// 안전하다: 걸리면 사람이 한 번 더 보게 될 뿐이다.
//
// 코퍼스는 이 스캔과 같다(`src/components` 아래 `.ts`+`.tsx`, `__tests__` 디렉터리와
// `*.test.*`·`*.spec.*` 제외 — 오늘 298개). 그 코퍼스에서 마커별 실측(2026-09-19,
// §359 재측정): createElement 7 · appendChild 2 · insertBefore 1 · innerHTML 1 ·
// outerHTML 1 · replaceChildren 3 · createDocumentFragment 1 · `.append(` 4.
// 0건이지만 표준 DOM 구성 API라 넣은 것 넷: insertAdjacentHTML, insertAdjacentElement,
// cloneNode, createTextNode.
//
// ‼️ 앞 판의 숫자 둘이 틀렸고, 하나는 이 브랜치가 바꿨다. replaceChildren 을 "1개
// (pdf-find-render.ts)" 라고 적었지만 실측 3개다 — PluginViewerHost.tsx 와 PdfPage.tsx
// 가 §271(`8446d5b1`)부터 있었으므로 쓸 때부터 틀렸다. `.append(` 는 3→4 인데 그건
// §359 가 `ui/ShadowIsolated.tsx` 를 더했기 때문이다. 세는 스캔을 좁게 돌리면 이렇게
// 된다는 실례이므로 숫자와 함께 남긴다.
//
// `.append(`만 DOM 이 아닌 흔한 뜻이 있다(FormData.append, URLSearchParams.append).
// 리포 전체(`src`, 테스트 제외)에서 지금 걸리는 **8건**은 전부 DOM(tooltip-core.ts,
// ui/ShadowIsolated.tsx, pdf-text-layer-selection.ts, pdf-find-render.ts, main.tsx,
// export-html-anchors.ts, task-chip-label.ts, date-picker.ts — 앞 판은 6건이라 적었고
// main.tsx 를 빠뜨렸다) — 나중에 FormData.append 오탐이 나오면 그건 마커를 지울
// 이유가 아니라 한 번 들여다보라는 신호다.
//
// ‼️ 그리고 그 "지우지 말라" 는 **주석이 아니라 테스트가** 지킨다(아래
// MARKER_FIXTURES). 주석만 있을 때는 오탐을 만난 사람이 마커를 지우면 자기 테스트가
// 초록이 되고 다른 어떤 테스트도 움직이지 않았다 — 검사를 무력화하는 편집이 무료였다.
const DOM_CONSTRUCTION_MARKERS = [
  "createElement",
  "appendChild",
  "insertBefore",
  "insertAdjacentHTML",
  "insertAdjacentElement",
  "innerHTML",
  "outerHTML",
  "replaceChildren",
  "cloneNode",
  "createTextNode",
  "createDocumentFragment",
  ".append(",
];

// 확장자 검사와 마커 루프가 한 `it()` 안에 순서대로 있어, 어떤 파일이 `.ts`가
// 아니면 `expect(f.endsWith(".ts")).toBe(true)`가 먼저 던지고 그 파일의 마커
// 루프는 아예 실행되지 않는다 — 즉 `.tsx`를 이 목록에 잘못 넣으면 마커 검사가
// 아니라 확장자 검사가 잡는다(2026-09-19 반례로 확인: 실패 메시지가
// `expected false to be true`였다, 마커 검사의 `expected true to be false`가
// 아니라). 마커 루프가 실제로 실행되는 건 확장자가 맞는 파일뿐이다.
it("NON_RENDERING_EFFECT_CALLERS 원소는 .ts 이고 DOM 구성 마커가 없다", () => {
  for (const f of NON_RENDERING_EFFECT_CALLERS) {
    expect(f.endsWith(".ts")).toBe(true);
    const src = readFileSync(path.join(ROOT, f), "utf-8");
    for (const marker of DOM_CONSTRUCTION_MARKERS) {
      expect(src.includes(marker)).toBe(false);
    }
  }
});

/**
 * 마커 하나하나가 실제로 무언가를 잡는다는 증거 — 양성 대조군.
 *
 * ‼️ 위 `it()` 의 루프는 `DOM_CONSTRUCTION_MARKERS` 를 순회하므로 **배열이 비면 아무
 * 것도 단언하지 않는다.** 마커를 하나 지워도 마찬가지로 조용하다. 형제 테스트들(합집합·
 * 서로소·확장자)은 마커를 아예 쳐다보지 않으므로 이 파일에서 그 편집을 알아채는 것이
 * 없었다.
 *
 * 각 항목은 "이 파일을 스캔하면 **정확히** 이 마커들이 걸린다" 이다. 집합이므로 마커
 * 하나를 배열에서 지우면 그 마커를 담은 항목의 집합이 달라져 빨개진다. 0건 마커 넷은
 * 코퍼스에 양성 대조군이 없어 이 방식으로 덮을 수 없고, 아래에서 이름으로 고정한다.
 */
const MARKER_FIXTURES: [string, string[]][] = [
  ["src/components/journal/utils.ts", ["innerHTML"]],
  ["src/components/toolbar/context-menu-table.ts", ["outerHTML"]],
  ["src/components/editor/PluginViewerHost.tsx", ["replaceChildren"]],
  [
    "src/components/editor/pdf/use-pdf-highlight-ref-preview.ts",
    ["createElement"],
  ],
  [
    "src/components/editor/pdf/pdf-find-render.ts",
    [".append(", "createDocumentFragment", "createElement", "replaceChildren"],
  ],
  [
    "src/components/editor/pdf/pdf-text-layer-selection.ts",
    [".append(", "createElement", "insertBefore"],
  ],
  [
    "src/components/sidebar/hooks/use-file-tree-dnd.ts",
    ["appendChild", "createElement"],
  ],
];

/** 코퍼스에 0건이라 양성 대조군을 만들 수 없는 넷. 이름으로만 고정한다. */
const ASPIRATIONAL_MARKERS = [
  "cloneNode",
  "createTextNode",
  "insertAdjacentElement",
  "insertAdjacentHTML",
];

it("마커를 지우거나 비우면 이 테스트가 빨개진다", () => {
  const covered = new Set<string>();
  for (const [file, expected] of MARKER_FIXTURES) {
    const src = readFileSync(path.join(ROOT, file), "utf-8");
    const found = DOM_CONSTRUCTION_MARKERS.filter((m) =>
      src.includes(m),
    ).sort();
    expect([file, found]).toEqual([file, expected]);
    for (const marker of expected) covered.add(marker);
  }
  // 픽스처가 0건 넷을 뺀 전부를 덮는지 — 덮지 못하는 마커는 지워도 위 루프가 조용하다.
  expect([...covered].sort()).toEqual(
    DOM_CONSTRUCTION_MARKERS.filter(
      (m) => !ASPIRATIONAL_MARKERS.includes(m),
    ).sort(),
  );
  // 그 넷은 이름으로. 지우려면 이 줄도 같이 지워야 하고, 그러면 위 주석을 읽게 된다.
  for (const marker of ASPIRATIONAL_MARKERS) {
    expect([marker, DOM_CONSTRUCTION_MARKERS.includes(marker)]).toEqual([
      marker,
      true,
    ]);
  }
});
