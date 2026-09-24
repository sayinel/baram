// §365 스펙 0057 §7 검사 5 — CSS 파일 밖(TS/TSX)에 적힌 간격·모서리를 센다.
// stylelint 관문과 해상도 스냅샷은 CSS 파일만 읽는다(0058 §8.3). 이 채널에 값이
// 돌아오면 그 자리는 밀도·모서리 다이얼을 따라오지 않는다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { walk } from "./css-rules";
import { type Channel, scanSource } from "./inline-spacing-scan";

const channels = (source: string): Channel[] =>
  scanSource("fixture.tsx", source).map((hit) => hit.channel);

describe("스캐너 — 잡아야 하는 것", () => {
  it.each([
    ["style-px", `<div style={{ padding: "8px 12px" }} />`],
    ["style-px", `const S = { borderRadius: "6px" };`],
    ["style-px", "<div style={{ paddingLeft: `${INDENT}px` }} />"],
    ["style-number", `<div style={{ marginTop: 12 }} />`],
    ["style-number", `const o = { gap: -4 };`],
    ["css-text", `el.style.cssText = "color:red;padding:32px";`],
    ["css-text", "const css = `.mark { border-radius: 2px }`;"],
    // 삼항의 두 갈래가 모두 리터럴이면 새는 값이 있는지 본다 — 잎을 모아 판정한다.
    ["style-px", `<div style={{ padding: cond ? "8px" : "0px" }} />`],
    ["style-number", `<div style={{ marginTop: cond ? 12 : 0 }} />`],
  ] as const)("%s ← %s", (channel, source) => {
    expect(channels(source)).toEqual([channel]);
  });

  // 유틸 하나가 한 번씩 센다 — 변형(`last:`)을 벗겨도 센다.
  it("className 의 Tailwind 간격·rounded 유틸", () => {
    expect(channels(`<p className="mb-2 last:mb-0 italic" />`)).toEqual([
      "tailwind",
      "tailwind",
    ]);
    expect(channels('<p className={`rounded ${on ? "px-1" : ""}`} />')).toEqual(
      ["tailwind", "tailwind"],
    );
  });
});

describe("스캐너 — 잡으면 안 되는 것", () => {
  // 무엇이 이것을 실패시키는가: 정규식 스캔으로 되돌리면 주석 두 줄이 걸린다
  // (0058 §8.3 의 줄 단위 스캔이 `theme-gallery.tsx` 머리 주석을 셌다).
  it.each([
    `<div style={{ padding: 0, margin: "0" }} />`,
    `<div style={{ padding: "0.5em", borderRadius: "50%" }} />`,
    `<div style={{ width: 560, fontSize: "14px" }} />`,
    `// padding: 8px in a comment`,
    `/* marginTop: 12 */`,
    `<p className="italic font-semibold w-full" />`,
    `<div data-x="p-2" />`,
    // 삼항의 두 갈래가 모두 0 이면(단위 섞여도) 셀 값이 없다.
    `<div style={{ padding: cond ? 0 : "0" }} />`,
    // 호출은 값이 아니라 인자다 — 안으로 내려가지 않는다.
    `<div style={{ padding: toPx(8) }} />`,
  ])("%s", (source) => {
    expect(channels(source)).toEqual([]);
  });
});

/**
 * 남아 있는 값 — 파일별·갈래별 개수. 여기 없는 파일은 0 이어야 한다.
 *
 * 항목 12개는 출처가 둘이다. 항목을 묶은 각 무리 위의 주석이 그 무리의 출처를 적는다.
 *   ① 스펙 0057 §8 이 그대로 둔다고 적은 파일 11개 — §8.2 의 마운트되지 않는 Agent
 *      컴포넌트 넷, §8.3 의 `src/spike/` 세 파일 · `main.tsx` · `katex-to-png.ts` ·
 *      export 두 파일(`export-html-code-block.ts` · `export-html-styles.ts`).
 *   ② style 이 아닌 객체의 값 1개 — `SkillDependencySection.tsx` 의 cytoscape 옵션
 *      `padding`(스펙 0057 §7 검사 5 · 계획 0101 판정 P3: 래칫은 style 객체를 가려내지
 *      않고 이유와 함께 싣는다).
 * 스펙 §7 이 또 하나의 출처로 둔 "§5.2 의 기하 판정이 리터럴로 남긴 값" 은 항목을 내지
 * 않았다 — 행 데이터인 깊이로 계산하는 들여쓰기(`file-tree-types.ts` 의 `treeIndent` ·
 * `Outline.tsx` · `TagPanel.tsx` · `MoveToFolderModal.tsx` · `table-of-contents-view.tsx`)는
 * 인라인에 남되 `calc(… var(--space-*))` 꼴이라 이 스캐너가 세는 px 리터럴이 없다.
 * 새 항목은 셋 가운데 하나의 이유를 단다 — ①, ②, 또는 ③ 스펙 §7 이 고정 목록의 출처로
 * 적은 "§5.2 의 기하 판정이 리터럴로 남긴 값"(오늘은 항목이 없다). 셋 다 아니면 개수를
 * 올리기 전에 그 값이 인라인에 남을 이유부터 판정받는다.
 */
const PINNED: Record<string, Partial<Record<Channel, number>>> = {
  // 그대로 둔다(0057 §8.2) — 마운트되지 않는 Agent 컴포넌트 넷, 다이얼이 닿지 않는다.
  "src/components/ai/AgentDiffView.tsx": { tailwind: 9 },
  "src/components/ai/AgentPanel.tsx": { tailwind: 10 },
  "src/components/ai/AgentPlanView.tsx": { tailwind: 11 },
  "src/components/ai/AgentProgressBar.tsx": { tailwind: 3 },

  // 그대로 둔다(판정 P3) — cytoscape 레이아웃 옵션의 `padding`, style 객체가 아니다.
  "src/components/sidebar/SkillDependencySection.tsx": { "style-number": 1 },

  // 그대로 둔다(0057 §8.3) — 스파이크 프로토타입, 다이얼이 닿을 화면이 아니다.
  "src/spike/ime-probe/ImeProbe.tsx": { "style-number": 19, "style-px": 2 },
  "src/spike/ime-probe/cm-instance.ts": { "style-px": 1 },
  "src/spike/vim-wysiwyg-probe/VimWysiwygProbe.tsx": {
    "style-number": 12,
    "style-px": 1,
  },

  // 그대로 둔다(0057 §8.3) — 부팅 실패 화면, 다이얼이 닿을 화면이 아니다.
  "src/main.tsx": { "css-text": 3 },

  // 그대로 둔다(0057 §8.3·§8.5) — export 산출물, 다이얼이 닿을 화면이 아니다.
  "src/utils/export/export-html-code-block.ts": { "css-text": 2 },
  "src/utils/export/export-html-styles.ts": { "css-text": 2 },
  "src/utils/katex/katex-to-png.ts": { "css-text": 2 },
};

const corpus = (): string[] =>
  [...walk("src", ".ts"), ...walk("src", ".tsx")].filter(
    (file) =>
      !file.includes("/__tests__/") &&
      !/\.test\.tsx?$/u.test(file) &&
      !file.endsWith(".d.ts"),
  );

describe("코퍼스 — 스케일 밖 간격·모서리는 고정 목록만큼만 있다", () => {
  // 무엇이 이것을 실패시키는가: 옮긴 표면에 인라인 px 가 돌아오거나, 새 파일이
  // 이 채널을 열면. 고정 목록의 개수가 줄어도 실패한다 — 줄인 사람이 목록을
  // 고치게 해서, 래칫이 내려간 기록이 diff 에 남는다.
  it("파일별 개수가 PINNED 와 같다", () => {
    const actual: Record<string, Partial<Record<Channel, number>>> = {};
    for (const file of corpus()) {
      for (const { channel } of scanSource(file, readFileSync(file, "utf8"))) {
        actual[file] ??= {};
        actual[file][channel] = (actual[file][channel] ?? 0) + 1;
      }
    }
    expect(actual).toEqual(PINNED);
  });

  // 비공허성: walk 경로가 틀리면 코퍼스가 비고, 위 테스트는 빈 PINNED 와 함께
  // 초록이 된다.
  it("코퍼스가 비어 있지 않다", () => {
    expect(corpus().length).toBeGreaterThan(500);
  });
});
