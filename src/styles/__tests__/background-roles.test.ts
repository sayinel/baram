// §365 다이얼 2 (스펙 0059 §4 · §6) — 배경 역할 토큰 둘.
//
// `bg-subtle` 은 크롬 바(탭·상태·컨텍스트 탭)와 본문 안의 움푹한 표면(코드 블록·콜아웃)을,
// `bg-default` 는 본문과 크롬 위의 호버·활성 채움을 겸한다. 배경 대비 다이얼은 각 쌍의
// 앞쪽만 옮겨야 하므로 크롬 쪽이 별칭 둘을 읽는다. 이 파일은 (1) 별칭이 기본 화면을
// 바꾸지 않는 모양으로 정의돼 있는지와 (2) 옮긴 선언 22개가 그 별칭을 읽는지를 고정한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

/** 생성 스타일시트에서 한 변수의 값 — 주석을 걷고 공백을 접는다. prettier 가
 *  `var(\n --x\n )` 로 줄을 바꾸므로 괄호 안쪽 공백도 지운다. */
function generated(file: string, name: string): string | undefined {
  const css = readFileSync(`src/styles/generated/${file}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")");
  return new RegExp(`${name}: ([^;]+);`, "u").exec(css)?.[1].trim();
}

describe("역할 토큰의 정의 (스펙 0059 §4)", () => {
  // 무엇이 이것을 실패시키는가: 별칭이 primitive 를 가리키면(`{color.slate.50}`) 테마가
  // 인라인으로 쓴 `bg-subtle` 을 바가 따라가지 않아, 설치 테마마다 탭 바가 기본 팔레트
  // 색으로 굳는다. `var(--color-bg-subtle)` 참조라야 오늘과 같은 색이 나온다.
  it.each(["semantic-light.css", "semantic-dark.css"])(
    "%s 에서 두 역할 토큰은 bg-subtle · bg-default 의 참조다",
    (file) => {
      expect(generated(file, "--color-bg-bar")).toBe("var(--color-bg-subtle)");
      expect(generated(file, "--color-bg-chrome-fill")).toBe(
        "var(--color-bg-default)",
      );
    },
  );

  // `system-dark.css` 는 별칭을 리터럴로 낸다(스펙 0059 §4 — 그래서 다이얼은 별칭
  // 전파에 기대지 않는다). 여기서 보는 것은 그 리터럴이 짝의 값과 **같다**는 것 —
  // 다르면 OS 다크의 `system` 에서 탭 바 색이 바뀐다.
  it("system-dark.css 의 리터럴은 짝의 값과 같다", () => {
    const subtle = generated("system-dark.css", "--color-bg-subtle");
    const page = generated("system-dark.css", "--color-bg-default");
    expect(subtle).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(page).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(generated("system-dark.css", "--color-bg-bar")).toBe(subtle);
    expect(generated("system-dark.css", "--color-bg-chrome-fill")).toBe(page);
  });
});

/** [파일, 선택자, 속성] — 좌표는 행 번호가 아니라 선택자다(표류하지 않는다). */
type Site = readonly [file: string, selector: string, prop: string];

/** 스펙 0059 §6.2 — 크롬 바. */
const BAR: readonly Site[] = [
  ["layout.css", ".tab-bar", "background-color"],
  ["layout.css", ".tab-scroll-btn", "background-color"],
  ["file-tree.css", ".status-bar", "background-color"],
  ["context-tab-bar.css", ".context-tab-bar", "background"],
];

/** 스펙 0059 §6.3 — 크롬·바 위에 놓인 채움. `.backlinks-context` 는 아래에서 따로 본다.
 *  스펙이 적은 `journal-notes.css` 의 `.notes-create-btn` · `.notes-tag-chip` · `.notes-card` 는
 *  뺐다 — 렌더하는 컴포넌트가 없다(Notes 탭은 7f3dadc9 에서 지워졌고 CSS 가 남았다).
 *  스펙 §6.4 가 렌더되지 않는 `.mode-indicator` 를 옮기지 않은 것과 같은 규칙이다. */
const FILL: readonly Site[] = [
  ["layout.css", ".activity-bar-btn:hover", "background-color"],
  ["layout.css", ".tab-scroll-btn:hover", "background-color"],
  ["layout.css", ".tab-item:hover", "background-color"],
  ["layout.css", ".status-space-btn", "background-color"],
  ["file-tree.css", ".file-tree-action-btn:hover", "background"],
  ["file-tree.css", ".file-tree-open-btn", "background"],
  ["file-tree.css", ".file-tree-item:hover", "background-color"],
  ["file-tree.css", ".file-tree-item-active", "background-color"],
  ["file-tree.css", ".outline-item:hover", "background-color"],
  ["file-tree.css", ".status-mode", "background-color"],
  ["file-tree.css", ".status-git-branch", "background-color"],
  ["file-tree.css", ".file-tree-access-error-retry", "background"],
  ["journal-extras.css", ".photo-gallery-mode-btn-active", "background"],
  ["journal-notes.css", ".memories-mini-calendar", "background"],
  ["journal-notes.css", ".memories-mode-btn-active", "background"],
  ["snapshot.css", ".snapshot-restore-btn.secondary", "background"],
  ["zettelkasten.css", ".zettel-hub-action", "background"],
];

const RULES = cssRules();

/** 그 선택자·속성의 선언 값 — 정확히 하나여야 한다(둘이면 어느 쪽이 이기는지 모른다). */
function valueAt([file, selector, prop]: Site): string {
  const values = RULES.filter(
    (r) => r.file === `src/styles/${file}` && r.selector === selector,
  )
    .flatMap((r) => cssDeclarations(r.body))
    .filter((d) => d.prop === prop)
    .map((d) => d.value.replace(/\s+/gu, " "));
  expect(values, `${file} ${selector} { ${prop} }`).toHaveLength(1);
  return values[0];
}

describe("옮긴 선언 (스펙 0059 §6)", () => {
  // 비공허성: 목록이 잘리면 아래 루프가 덜 돈다. 바 4 + 채움 17 + 혼합 1 = 22.
  it("목록은 바 넷 · 채움 열일곱 · 혼합 하나다", () => {
    expect(BAR).toHaveLength(4);
    expect(FILL).toHaveLength(17);
  });

  // 무엇이 이것을 실패시키는가: 하나를 `var(--color-bg-subtle)` 로 되돌리면 그 바는
  // `flat` 에서 본문 색으로 내려오지 않고 코드 블록 색에 남는다.
  it.each(BAR)("%s %s 는 --color-bg-bar 를 읽는다", (file, selector, prop) => {
    expect(valueAt([file, selector, prop])).toBe("var(--color-bg-bar)");
  });

  // 무엇이 이것을 실패시키는가: 하나를 `var(--color-bg-default)` 로 되돌리면 `flat` 에서
  // 그 채움이 크롬과 같은 색이 된다 — `.file-tree-item-active` 라면 활성 파일 강조가 사라진다.
  it.each(FILL)(
    "%s %s 는 --color-bg-chrome-fill 을 읽는다",
    (file, selector, prop) => {
      expect(valueAt([file, selector, prop])).toBe(
        "var(--color-bg-chrome-fill)",
      );
    },
  );

  // `color-mix` 의 첫 피연산자만 바뀐다. 둘째(`bg-panel`)는 크롬 자신이라 그대로다.
  it(".backlinks-context 의 혼합은 채움과 크롬을 섞는다", () => {
    const value = valueAt([
      "links.css",
      ".backlinks-context",
      "background-color",
    ]);
    expect(value).toContain("var(--color-bg-chrome-fill) 85%");
    expect(value).toContain("var(--color-bg-panel)");
    expect(value).not.toContain("--color-bg-default");
  });
});
