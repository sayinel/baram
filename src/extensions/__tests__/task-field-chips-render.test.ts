// §308 리뷰 M2 — 칩이 실제로 **무엇을 DOM과 스타일시트에 남기는지** 본다.
//
// `task-field-chips.test.ts`는 데코레이션의 구간(위치)을 지킨다. 여기는 그
// 데코레이션이 렌더된 뒤의 계약을 지킨다: 원문이 어떤 클래스로 감춰지는지,
// 그 감추기가 접근성 트리를 비우지 않는지, 칩이 보조기술에 중복으로 읽히지
// 않는지.
//
// 왜 CSS 파일을 읽는가: jsdom은 스타일시트를 로드하지 않아 렌더 테스트로는
// 계산된 스타일을 볼 수 없다(`pdf-highlight-swatch-css.test.ts`와 같은 이유).
// 그런데 이 기능이 빠진 구멍이 정확히 그 층이었다 — 칩은 `aria-hidden="true"`,
// 원문은 `display: none`이라 스크린리더에서 메타데이터가 **양쪽 다** 사라졌고,
// 구조만 보는 테스트는 전부 초록이었다. (M3-a에서 `aria-hidden`은 칩에서 원문으로
// 옮겨갔다 — 칩이 조작이 되었기 때문이다. 감추기가 `display: none`이면 안 된다는
// 규칙은 그대로다.)

import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, Selection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { renderTaskChip } from "../plugins/task-chip-label";
import {
  buildTaskFieldDecorations,
  createTaskFieldChipsPlugin,
  RAW_CLASS,
  RAW_HIDE_CLASS,
} from "../plugins/task-field-chips";

// 렌더하려면 `toDOM`이 있어야 한다 — 위치 테스트의 스키마에는 없다.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    taskList: {
      content: "taskItem+",
      group: "block",
      toDOM: () => ["ul", 0],
    },
    taskItem: {
      content: "paragraph block*",
      attrs: { checked: { default: false } },
      toDOM: () => ["li", 0],
    },
  },
});

const TODAY = new Date(2026, 7, 25); // 2026-08-25

/** `Decoration.inline`에 넘긴 attrs — 공개 타입이 아니라 여기서 좁혀 쓴다. */
interface DecorationAttrs {
  class?: string;
}

/** 칩의 기준일 — 픽스처 날짜(2026-08-*)와 같은 해라 연도는 접힌다. */
const CHIP_TODAY = new Date(2026, 7, 25);

const baseCss = readFileSync(
  join(process.cwd(), "src/styles/base.css"),
  "utf8",
);

const tasksCss = readFileSync(
  join(process.cwd(), "src/styles/tasks.css"),
  "utf8",
);

/** §306 우선순위 레일의 네 단계 — `TaskPriorityLevel`과 **같은 글자**여야 한다. */
const RAIL_LEVELS = ["urgent", "high", "low", "lowest"] as const;

/**
 * `.task-row[data-priority="…"]::before` 규칙에서 한 속성의 선언 값.
 *
 * 레일은 의사 요소라 jsdom 렌더로는 보이지 않는다 — 이 스위트가 CSS 파일을 읽는
 * 이유와 같다(파일 머리 주석 참조).
 */
function railDecl(level: string, prop: string): string {
  const body = new RegExp(
    `\\.task-row\\[data-priority="${level}"\\]::before\\s*\\{([^}]*)\\}`,
  ).exec(tasksCss)?.[1];
  expect(body, `no rail rule for ${level}`).toBeDefined();
  const decl = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(
    body ?? "",
  )?.[1];
  return (decl ?? "").trim();
}

/** `.visually-hidden` 규칙 본문. */
function hideRule(): string {
  const match = new RegExp(`\\.${RAW_HIDE_CLASS}\\s*\\{([^}]*)\\}`).exec(
    baseCss,
  );
  expect(match, `no .${RAW_HIDE_CLASS} rule in base.css`).not.toBeNull();
  return match?.[1] ?? "";
}

/** `selectionFrom`의 기본값 -1 = 어떤 항목도 건너뛰지 않는다(커서 없는 화면). */
function render(
  md: string,
  selectionFrom = -1,
): { host: HTMLElement; view: EditorView } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = markdownToProsemirror(md, schema);
  const state = EditorState.create({
    doc,
    plugins: [
      new Plugin({
        props: {
          decorations: (s) =>
            buildTaskFieldDecorations(s.doc, selectionFrom, TODAY),
        },
      }),
    ],
    schema,
  });
  return { host, view: new EditorView(host, { state }) };
}

describe("§308 원문 구간의 렌더 계약", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it("원문 이모지 필드를 감추는 span에 두 클래스를 모두 붙인다", () => {
    // `task-field-raw`는 **무엇**을(의미), `visually-hidden`은 **어떻게**(감추는
    // 방법)를 말한다. 이 두 문자열이 플러그인과 스타일시트를 잇는 유일한 계약이라,
    // 어느 한쪽만 바뀌면 원문이 감춰지지 않고 필드가 두 번(원문 + 칩) 보인다.
    const rendered = render("- [ ] 보고서 초안 📅2026-08-30");
    view = rendered.view;

    const raw = rendered.host.querySelector<HTMLElement>(`.${RAW_CLASS}`);
    expect(raw, `no .${RAW_CLASS} element rendered`).not.toBeNull();
    expect(raw?.classList.contains(RAW_HIDE_CLASS)).toBe(true);
    expect(raw?.textContent).toBe("📅2026-08-30");
  });

  it("본문 전체가 필드 하나인 줄에도 문단이 비지 않는다 (리뷰 m7)", () => {
    // 이 슬라이스에서 "줄을 클릭해 원문을 드러낸다"는 탈출구에 클릭할 보이는
    // 글자가 없는 유일한 형태다. `display: none`이었다면 문단의 인라인 내용이
    // **통째로** 렌더되지 않고 `contenteditable=false` 위젯 하나만 남는다.
    // 지금은 원문 span이 흐름 안에 남으므로(1px로 잘릴 뿐) 문단은 언제나
    // 위치를 가진 요소를 갖는다.
    const rendered = render("- [ ] 📅2026-08-30");
    view = rendered.view;

    const p = rendered.host.querySelector("p");
    expect(p?.querySelector(`.${RAW_CLASS}`)).not.toBeNull();
    expect(p?.querySelector(".task-chip")).not.toBeNull();
    // 문서 모델은 그대로다 — 위·아래 줄에서 방향키로 들어오는 경로는 데코레이션과
    // 무관하게 살아 있고, Home/End도 이 텍스트 안에서 움직인다.
    expect(rendered.view.state.doc.textContent).toBe("📅2026-08-30");
  });

  it("원문 텍스트가 문서에 그대로 남는다 — 칩은 시각적 중복일 뿐이다", () => {
    const rendered = render("- [ ] 보고서 초안 📅2026-08-30");
    view = rendered.view;
    // 칩(8/30)과 원문(2026-08-30)이 함께 있다. 이것이 칩에 `aria-hidden`을
    // 붙일 수 있는 **유일한** 근거다.
    expect(rendered.host.textContent).toContain("📅2026-08-30");
    expect(rendered.host.querySelector(".task-chip")).not.toBeNull();
  });
});

describe("§308 감추기 관용구 (리뷰 M2)", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it("접근성 트리에서 지우는 방법으로 감추지 않는다", () => {
    // ‼️ 이 테스트의 요점. `display: none`(또는 `visibility: hidden`)이면 칩의
    // `aria-hidden="true"`와 합쳐져 메타데이터가 **양쪽 다** 사라진다 — 스크린
    // 리더 사용자는 커서가 그 항목에 들어가 있는 동안 말고는 마감도 우선순위도
    // 시작일도 영영 듣지 못한다.
    const body = hideRule();
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
    expect(tasksCss).not.toMatch(
      new RegExp(`\\.${RAW_CLASS}\\s*\\{[^}]*display:\\s*none`),
    );
  });

  it("보이지 않게는 확실히 감춘다", () => {
    // 감추지 **않는** 것도 결함이다 — 원문과 칩이 같은 정보를 두 번 보인다.
    const body = hideRule();
    expect(body).toMatch(/clip-path:/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it("흐름 안에 남는다 — contenteditable 안에서 캐럿이 줄 밖으로 끌려가지 않게", () => {
    // ‼️ 고전적인 visually-hidden은 `position: absolute`를 쓴다. 그것을
    // contenteditable 안의 인라인 span에 붙이면 그 span이 줄 상자를 떠나고,
    // 캐럿이 그 안으로 들어가는 순간 따라 나간다. 흐름에 남기는 대신 1px로
    // 잘라내는 이유가 이것이다.
    //
    // jsdom에는 레이아웃이 없어 캐럿의 실제 픽셀 위치는 여기서 볼 수 없다.
    // 볼 수 있는 것은 그 위치를 **보장하는 성질** — 흐름을 벗어나지 않는다 —
    // 이고, 그것이 이 단언이다.
    const body = hideRule();
    expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
  });

  it("커서가 그 줄에 들어가면 감춤이 통째로 사라진다", () => {
    // 캐럿이 감춰진 span **안**에 머무는 상태 자체가 없다는 것이 이 설계의
    // 핵심이다: 항목에 커서가 들어가는 순간 그 항목의 데코레이션이 전부
    // 사라지므로, 감추기 관용구가 캐럿에 영향을 줄 수 있는 창은 선택이 바뀌는
    // 그 한 틱뿐이다. 위의 "흐름 안에 남는다"와 합쳐야 이 계약이 닫힌다.
    const md = "- [ ] 보고서 초안 📅2026-08-30";
    // 문단 안쪽 = taskList(0) > taskItem(1) > paragraph(2) > 첫 글자(3)
    const rendered = render(md, 3);
    view = rendered.view;

    expect(rendered.host.querySelector(`.${RAW_CLASS}`)).toBeNull();
    expect(rendered.host.querySelector(".task-chip")).toBeNull();
    expect(rendered.host.querySelector("p")?.textContent).toBe(
      "보고서 초안 📅2026-08-30",
    );
  });
});

describe("§308 칩의 색 규칙 (리뷰 m4)", () => {
  // "아웃라인 기본, **기한 초과만** 색을 갖는다"는 CSS 주석·registry `_note`·
  // 계획서가 모두 적어 둔 규칙인데 배포된 CSS는 우선순위 칩에도 색을 줬다.
  // 이 방향을 고른 이유 자체가 "기한 초과만 소리친다"이므로, 산문이 규칙이다.
  it("색을 갖는 칩 상태는 기한 초과 하나뿐이다", () => {
    // ‼️ 열거로 잡는다. `.task-chip-priority`가 없다는 것만 보면 다음에 다른
    // 상태(시작일·방치…)에 색을 더할 때 조용히 다시 어긋난다.
    const coloured = [
      ...tasksCss.matchAll(/(\.task-chip[\w-]*)\s*\{([^}]*)\}/g),
    ]
      .filter((m) => /--color-status-/.test(m[2]))
      .map((m) => m[1]);
    expect(coloured).toEqual([".task-chip-overdue"]);
  });

  it("기본 칩은 상자가 없다 — 점 하나뿐이라 채움도 `.wikilink-date`와 갈라진다(§316)", () => {
    // 방향 C: 알약(테두리)이 사라지고 `::before` 색점만 남는다. `.tag-node`와
    // 같은 철학 — 상자 없이 조용한 텍스트 + 점 하나.
    const body = /\.task-chip\s*\{([^}]*)\}/.exec(tasksCss)?.[1];
    expect(body, "no .task-chip rule").toBeDefined();
    expect(body).not.toMatch(/border:/);
    expect(body).not.toMatch(/background/);
    const dot = /\.task-chip::before\s*\{([^}]*)\}/.exec(tasksCss)?.[1];
    expect(dot, "no .task-chip::before rule").toBeDefined();
    expect(dot).toMatch(/content:\s*""/);
    expect(dot).toMatch(/border-radius:\s*50%/);
  });

  it("우선순위 칩에는 색 전용 클래스를 붙이지 않는다", () => {
    // 규칙이 사라졌으므로 클래스도 사라져야 한다 — 남겨 두면 CSS에 없는
    // 클래스를 JS가 계속 뿌리게 된다.
    const el = renderTaskChip(
      { emoji: "⏫", from: 0, kind: "priority", to: 1, value: "⏫" },
      false,
      "en",
      CHIP_TODAY,
    );
    expect([...el.classList]).toEqual(["task-chip"]);
  });
});

describe("§308 칩 대비 — 칩은 이 메타데이터의 유일한 시각 표현이다", () => {
  // ‼️ 이 테스트를 지우거나 완화하기 전에 읽을 것.
  //
  // 원문(`.task-field-raw`)은 `visually-hidden`이고 이제 `aria-hidden="true"`이며,
  // 칩이 접근성 트리에 남는다(M3-a에서 뒤집혔다 — 위 "칩의 접근성 계약" 참조).
  // 두 사실을 합치면 **칩이 이 메타데이터의 유일한 시각 표현**이라는 뜻이 된다:
  // 스크린리더는 원문으로 듣고, 눈으로 읽는 사람에게는 칩 말고 되짚을 것이 화면에
  // 없다. 그래서 대비를 낮추는 것은 심미 조정이 아니라 **스크린리더를 쓰지 않는
  // 저시력 사용자에게서 이 정보를 통째로 가져가는 일**이다 — 리뷰가 닫은 "칩과
  // 원문을 동시에 지우지 말라"(감추기를 `display: none`으로 되돌리는 실패 양식)의
  // 시각 버전이다. 한쪽 경로만 남겨 두는 설계라 남은 그 경로는 더 튼튼해야 한다.
  //
  // 그리고 `--color-text-muted`는 `--color-text-disabled`의 **별칭**이다
  // (`src/styles/generated/semantic-light.css`) — 살아 있는 메타데이터에 disabled
  // 색을 주는 셈이기도 하다.
  //
  // 왜 토큰 이름을 보는 얕은 테스트인가: jsdom에는 색 계산도 레이아웃도 없어 실제
  // 대비를 여기서 잴 수 없다. 그런데 이 결함이 들어온 표면이 정확히 **토큰 한 개의
  // 교체**였다(`secondary` → `muted`, 계획서의 지시였고 그것이 틀렸다). 재현 가능한
  // 회귀 표면을 그대로 못박는다.
  //
  // 실측(4.5:1 = 13px 텍스트의 AA 기준):
  //   라이트 에디터 #fff    muted 2.54:1 ❌ / secondary 4.83:1 ✅
  //   다크  에디터 #1a1a2e  muted 3.58:1 ❌ / secondary 6.65:1 ✅
  //   라이트 패널  #f1f3f5  muted 2.28:1 ❌ / secondary 4.35:1 (개선하되 여전히 AA 아래)
  //   다크  패널  #0f172a  muted 3.75:1 ❌ / secondary 6.96:1 ✅

  /** disabled 계층 토큰 — `--color-text-muted`는 `--color-text-disabled`의 별칭이다. */
  const DISABLED_TIER = /--color-text-(muted|disabled)/;

  /** 셀렉터 규칙의 `color:` 선언 값. `background-color:` 같은 접미 속성은 걸리지 않는다. */
  function colourDecl(selector: string): string {
    const body = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(
      tasksCss,
    )?.[1];
    expect(body, `no ${selector} rule in tasks.css`).toBeDefined();
    const decl = /(?:^|;)\s*color:\s*([^;]+)/.exec(body ?? "")?.[1];
    expect(decl, `no color declaration on ${selector}`).toBeDefined();
    return (decl ?? "").trim();
  }

  it("에디터 칩의 기본색이 disabled 계층 토큰이 아니다", () => {
    expect(colourDecl(".task-chip")).not.toMatch(DISABLED_TIER);
    // 값까지 못박는다 — 음수 단언만으로는 리터럴 `#9ca3af`로 같은 결함이 다시 들어온다.
    expect(colourDecl(".task-chip")).toBe("var(--color-text-secondary)");
  });

  it("아젠다 우선순위 레일은 네 단계가 서로 다른 색이다", () => {
    // §306 아젠다는 더 이상 텍스트 배지가 아니라 행 왼쪽의 세로 레일이다. 그래서 이
    // 스위트의 대비 논증이 그대로 옮겨 오지 않는다: 4px 배경 막대에는 13px 본문의 AA
    // 기준이 적용되지 않는다.
    //
    // 길이가 모두 같으므로(디자인 결정) **색이 유일한 시각 채널**이다. 그러면 네 값이
    // 서로 달라야 한다는 것이 최소 요건이고, 둘이 겹치는 순간 그 두 단계는 화면에서
    // 구별되지 않는다.
    const colours = RAIL_LEVELS.map((lvl) => railDecl(lvl, "background"));
    expect(new Set(colours).size).toBe(RAIL_LEVELS.length);

    // 그리고 시끄러운 두 단계는 disabled 계층으로 내려가지 않는다 — 그 계층은 "꺼져
    // 있음"을 뜻하므로 긴급이 그 톤으로 그려지면 뜻이 뒤집힌다.
    expect(railDecl("urgent", "background")).not.toMatch(DISABLED_TIER);
    expect(railDecl("high", "background")).not.toMatch(DISABLED_TIER);
  });

  it("레일은 색이 유일한 채널이므로 낱말 라벨이 반드시 남는다", () => {
    // 높이 채널을 포기한 대가다. `::before`는 접근성 트리에 없으므로, 감춘 텍스트가
    // 사라지면 스크린 리더 사용자에게 우선순위가 **통째로** 없는 것이 된다.
    // 행 마크업은 `TaskRow`에 있다 — 아젠다와 §315 주간 리뷰가 **같은 행**을 쓴다.
    const list = readFileSync(
      join(process.cwd(), "src/components/tasks/TaskRow.tsx"),
      "utf8",
    );
    expect(list).toMatch(/className="visually-hidden">\{priority\.label\}/);
  });
});

describe("§308 방향 C — 아젠다 우선순위는 .task-chip을 공유하지 않는다 (리뷰 m5 뒤집기)", () => {
  // 방향 A의 산출물은 "복사가 아닌 규칙 공유"(`.task-row-priority.task-chip`)였다.
  // 방향 C가 알약을 없애며 그 공유가 끝났고, §306 레일은 아예 텍스트가 아니다 —
  // `TaskBucketList`는 행에 `data-priority`만 붙이고 CSS가 막대를 그린다.
  it("네 단계가 모두 자기 배경을 선언한다 — 하나라도 빠지면 그 단계가 안 보인다", () => {
    for (const lvl of RAIL_LEVELS) {
      expect(railDecl(lvl, "background"), lvl).toMatch(/^var\(--color-/);
    }
  });

  it("감춘 우선순위 라벨이 행의 flex 흐름에서 빠져 있다", () => {
    // ‼️ `.visually-hidden`은 1px로 잘릴 뿐 **흐름에 남는** 관용구다(contenteditable
    // 캐럿 때문에 base.css가 일부러 그렇게 둔다). 그 스팬이 `.task-row`의 flex 아이템이
    // 되면 1px + `gap`이 제목 앞에 붙고, 우선순위가 있는 행에서만 붙으므로 목록의 왼쪽
    // 선이 행마다 어긋난다 — 실제로 사용자가 잡아낸 결함이다.
    const row = /\.task-row\s*\{([^}]*)\}/.exec(tasksCss)?.[1] ?? "";
    expect(row, "행이 flex가 아니면 이 규칙의 전제가 사라진다").toMatch(
      /display:\s*flex/,
    );
    expect(
      row,
      "gap이 없으면 비용이 1px뿐이라 이 테스트가 무의미해진다",
    ).toMatch(/gap:/);

    const hidden = /\.task-row\s*>\s*\.visually-hidden\s*\{([^}]*)\}/.exec(
      tasksCss,
    )?.[1];
    expect(hidden, "no .task-row > .visually-hidden rule").toBeDefined();
    expect(hidden).toMatch(/position:\s*absolute/);
  });

  it("행의 포커스 표시는 `:focus`다 — `:focus-visible`이면 보이지 않는다", () => {
    // ‼️ §315는 열자마자 첫 행에 **프로그램으로** 포커스를 건다. 브라우저는 그런 포커스를
    // 대개 `:focus-visible`로 치지 않으므로, 그 셀렉터를 쓰면 포커스는 실제로 거기 있는데
    // 화면에는 아무 표시가 없다 — 사용자에게는 "포커스가 안 잡힌다"로 보이고, 실제로
    // 그렇게 보고됐다.
    expect(tasksCss).toMatch(/\.task-row:focus\s*\{/);
    expect(tasksCss).not.toMatch(/\.task-row:focus-visible\s*\{/);
  });

  it("네 레일의 길이가 같다 — 왼쪽 가장자리가 행마다 흔들리지 않는다", () => {
    // 높이로 단계를 나르던 초판을 되돌린 결정이다(사용자 피드백). 되살아나면 목록의
    // 왼쪽 선이 다시 들쭉날쭉해지므로, 단계별 규칙에 세로 크기가 없다는 것을 고정한다.
    for (const lvl of RAIL_LEVELS) {
      expect(railDecl(lvl, "height"), lvl).toBe("");
      expect(railDecl(lvl, "top"), lvl).toBe("");
    }
  });

  it(".task-chip의 `vertical-align`은 에디터 자신의 인라인 흐름을 위한 것으로 남는다", () => {
    // 공유가 끝났다고 이 속성이 사라질 필요는 없다 — 에디터 프로즈 안에서
    // 칩은 여전히 인라인 위젯이다. `.task-row`가 flex라서 무효라는 이전의
    // "안전망" 서술은 더 이상 참이 아니다: 애초에 이 클래스를 안 쓴다.
    const row = /\.task-row\s*\{([^}]*)\}/.exec(tasksCss)?.[1];
    expect(row, "no .task-row rule").toBeDefined();
    expect(row).toMatch(/display:\s*flex/);
    expect(/\.task-chip\s*\{([^}]*)\}/.exec(tasksCss)?.[1]).toMatch(
      /vertical-align:/,
    );
  });
});

describe("§308 칩의 접근성 계약", () => {
  // ‼️ M3-a에서 **뒤집혔다.** M2-e의 칩은 보이기만 했으므로 `aria-hidden="true"`가
  // 옳았다 — 같은 정보가 원문으로 이미 트리에 있었다. 이제 칩은 **누를 수 있는
  // 조작**이라, 감춰 두면 보조기술에서 도달할 방법이 없는 버튼이 된다.
  //
  // 그래서 표식이 자리를 바꿨다: 조작이 있는 쪽(칩)이 트리에 남고, 중복인 쪽(원문)이
  // `aria-hidden`을 받는다. 정보는 여전히 한 번만 읽힌다.
  const chip = () =>
    renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
      "en",
      CHIP_TODAY,
    );

  it("칩은 접근성 트리에 남는다 — 누를 수 있는 것은 도달할 수 있어야 한다", () => {
    expect(chip().getAttribute("aria-hidden")).toBeNull();
  });

  it("버튼으로 보이고, 이름이 눈에 보이는 라벨과 같다", () => {
    const el = chip();
    expect(el.getAttribute("role")).toBe("button");
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("aria-label")).toBe(el.textContent);
  });

  it("‼️ `data-vim-suspend`를 붙이지 않는다", () => {
    // 그 마커는 "이 섬이 키를 소유한다"는 선언이다(§298 규약). 피커는 에디터 밖
    // 모달이라 키가 `view.dom`에 도달하지 않으므로 칩은 키를 소유하지 않는다 —
    // 붙이면 vim 사용자가 그 줄에서 타이핑을 잃는다.
    expect(chip().hasAttribute("data-vim-suspend")).toBe(false);
  });

  it("정체를 위치가 아니라 종류·값으로 말한다", () => {
    // 위치를 DOM에 구우면 문서가 바뀌는 순간 낡고, 그 낡은 값으로 쓰면 엉뚱한 글자를
    // 덮는다. 확정 시점의 위치는 `posAtDOM`이 그때 다시 구한다.
    const el = chip();
    expect(el.getAttribute("data-chip-kind")).toBe("due");
    expect(el.getAttribute("data-chip-value")).toBe("2026-08-30");
    expect(el.outerHTML).not.toMatch(/data-chip-(from|to|pos)/);
  });
});

describe("§308 플러그인 ↔ CSS 이름 계약", () => {
  it("플러그인이 붙이는 감추기 클래스를 base.css가 실제로 정의한다", () => {
    expect(baseCss).toContain(`.${RAW_HIDE_CLASS}`);
  });

  it("데코레이션의 class 속성이 두 이름을 모두 담는다", () => {
    const doc = markdownToProsemirror("- [ ] 초안 📅2026-08-30", schema);
    const inline = buildTaskFieldDecorations(doc, -1, TODAY)
      .find()
      .filter((d) => d.from < d.to);
    expect(inline).toHaveLength(1);
    // `Decoration`은 attrs를 공개 API로 내놓지 않는다 — 렌더된 DOM(위)이 1차
    // 증거이고, 여기서는 그 attrs가 상수에서 온다는 것만 못박는다.
    const attrs = (inline[0] as unknown as { type: { attrs: DecorationAttrs } })
      .type.attrs;
    expect(attrs.class?.split(" ")).toEqual([RAW_CLASS, RAW_HIDE_CLASS]);
  });
});

describe("§308 로케일 구독 — 이미 그려진 칩도 강제로 다시 그린다", () => {
  // 데코레이션은 문서 변경·선택 변경에만 다시 만들어진다. 설정에서 언어를
  // 바꾸는 것은 둘 중 어느 것도 아니므로, 이 구독이 없으면 문서 전체가 옛
  // 언어로 남는다. `vim-lifecycle.ts:55`/`code-block-node-view.ts:224`와 같은
  // 전례를 따라 실제 Editor(전체 Extension 세트)로 검증한다 — 위치 테스트의
  // 손으로 만든 Plugin에는 이 lifecycle 자체가 없다.
  let editor: Editor | null = null;

  function makeTaskEditor(): Editor {
    const e = new Editor({
      content: {
        content: [
          {
            content: [
              {
                attrs: { checked: false },
                content: [
                  {
                    content: [{ text: "초안 📅2026-08-30", type: "text" }],
                    type: "paragraph",
                  },
                ],
                type: "taskItem",
              },
            ],
            type: "taskList",
          },
          // taskItem 밖의 문단 — 커서를 여기로 옮겨야 taskItem 자신의 칩이
          // "편집 중" 취급으로 숨지 않는다.
          { content: [{ text: "x", type: "text" }], type: "paragraph" },
        ],
        type: "doc",
      },
      extensions: createBaramExtensions(),
    });
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    return e;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
    useSettingsStore.setState({ locale: "en" });
  });

  it("설정 로케일이 바뀌면 문서를 안 건드려도 칩 텍스트가 새 언어로 바뀐다", () => {
    editor = makeTaskEditor();
    expect(editor.view.dom.textContent).toContain("due 8/30");

    useSettingsStore.setState({ locale: "ko" });

    expect(editor.view.dom.textContent).toContain("8/30 기한");
    expect(editor.view.dom.textContent).not.toContain("due 8/30");
  });
});

describe("§308 로케일 구독 — destroy 시 실제로 구독이 끊긴다 (raw EditorView)", () => {
  // 위 테스트처럼 Tiptap의 `Editor`를 거치면 검증이 안 된다: `Editor.
  // dispatchTransaction`(`@tiptap/core`)이 `view.isDestroyed`를 이미 가드하므로,
  // destroy 이후 콜백이 여전히 살아있어도 dispatch가 조용히 no-op된다 — 구독
  // 해제를 깜빡해도 이 경로로는 절대 들키지 않는다. 그래서 여기서는 그 가드가
  // 없는 raw `EditorView`에 실제 Plugin(`createTaskFieldChipsPlugin`)을 직접
  // 꽂아, destroy 이후의 dispatch가 진짜로 죽은 뷰에 닿게 만든다.
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    useSettingsStore.setState({ locale: "en" });
  });

  it("destroy 이후에는 로케일 변경이 죽은 뷰에 dispatch되지 않는다", () => {
    const doc = markdownToProsemirror("- [ ] 초안 📅2026-08-30\n\nx", schema);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      plugins: [createTaskFieldChipsPlugin()],
      schema,
      selection: Selection.atEnd(doc),
    });
    view = new EditorView(host, { state });

    view.destroy();
    view = null;

    // 구독 해제가 빠지면 destroy 이후에도 콜백이 살아남아 이미 destroy()된
    // EditorView에 raw `dispatch`를 시도한다 — `docView`가 null이라 이 지점에서
    // 실제로 예외가 난다(prosemirror-view `updateStateInner` → `docView.update`).
    expect(() => useSettingsStore.setState({ locale: "ko" })).not.toThrow();
  });
});

// ── 위젯 key의 무효화 범위 (리뷰 Major 2) ────────────────────────────────
//
// `WidgetType.eq`는 `spec.key`가 같으면 `toDOM` 비교도 `compareObjs(spec)`도
// **도달하지 않고** 곧바로 기존 DOM을 재사용한다(prosemirror-view). 그러니 key는
// "이 칩이 무엇을 보이는가"를 결정하는 모든 입력을 담아야 한다. `from`·`kind`·
// `locale`만 담고 있던 동안 **값**과 **기한 초과 여부**가 빠져 있었다.
//
// 두 테스트 모두 선택을 taskItem **밖**에 둔다 — 안에 있으면 그 항목의
// 데코레이션이 통째로 사라져 재사용 여부를 볼 수 없다.

function chip(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(".task-chip");
}

/** 첫 텍스트 노드에서 `needle`이 시작하는 **절대** 위치. */
function posOfText(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const at = node.isText ? (node.text ?? "").indexOf(needle) : -1;
    if (at >= 0) found = pos + at;
    return found < 0;
  });
  expect(found, `"${needle}" not in doc`).toBeGreaterThanOrEqual(0);
  return found;
}

/** 실제 플러그인을 raw `EditorView`에 꽂는다 — Tiptap Editor를 거치지 않는다. */
function rawView(md: string): { host: HTMLElement; view: EditorView } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = markdownToProsemirror(md, schema);
  return {
    host,
    view: new EditorView(host, {
      state: EditorState.create({
        doc,
        plugins: [createTaskFieldChipsPlugin()],
        schema,
        // 문서 끝의 문단 = taskItem 밖. 여기 커서를 두어야 칩이 살아 있다.
        selection: Selection.atEnd(doc),
      }),
    }),
  };
}

describe("§308 위젯 key — 값이 바뀌면 칩도 바뀐다 (리뷰 Major 2)", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it("선택을 태스크 밖에 둔 채 같은 길이로 날짜를 바꾸면 칩이 새 값을 보인다", () => {
    // ‼️ 도달 경로는 실재한다: `find-replace.ts`의 `dispatchReplaceAll`은 매치마다
    // `tr.insertText`를 쌓아 **한 번** dispatch하고 선택을 전혀 설정하지 않는다.
    // 찾기 바에 포커스가 있는 동안 PM 선택은 태스크 밖에 머무르므로,
    // `2026-08-30` → `2026-09-15` 같은 **같은 길이** 일괄 치환이 정확히 이 형태다.
    // (외부 파일 변경 리로드·`ai-diff.ts` 적용도 같은 형태를 만든다.)
    const rendered = rawView("- [ ] 초안 📅2026-08-30\n\nx");
    view = rendered.view;
    expect(chip(rendered.host)?.textContent).toBe("due 8/30");

    // 마지막 한 글자만 바꾼다 — 길이가 같아야 필드의 시작 위치(key의 `from`)가
    // 그대로 남아 "key가 같아 보이는" 이 결함의 조건이 성립한다.
    const at = posOfText(view.state.doc, "2026-08-30");
    view.dispatch(view.state.tr.insertText("1", at + 9, at + 10));

    // 문서는 확실히 바뀌었다 — 아래 단언이 헛돌지 않는다는 증거.
    expect(view.state.doc.textContent).toContain("2026-08-31");
    expect(chip(rendered.host)?.textContent).toBe("due 8/31");
  });

  it("자정을 넘겨 기한이 지나면 칩이 overdue 색을 얻는다", () => {
    // `overdue`는 spec에는 있지만 key에 없으면 `compareObjs`까지 도달하지 못한다.
    // 실패 모양: 밤새 열어 둔 창에서 계속 타이핑하는 동안 데코레이션은 매번 다시
    // 만들어지는데(`docChanged`) 이미 그려진 칩만 어제 색으로 남는다 — §309가
    // "기한 초과는 소리친다"로 세운 계약이 조용히 깨진다.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 7, 25)); // 기한(8/30) 전
      const rendered = rawView("- [ ] 초안 📅2026-08-30\n\nx");
      view = rendered.view;
      expect(chip(rendered.host)?.classList.contains("task-chip-overdue")).toBe(
        false,
      );

      vi.setSystemTime(new Date(2026, 8, 1)); // 기한 후
      // 태스크 줄 **밖**을 고쳐 재구축만 유발한다. 태스크 줄 자체를 건드리면
      // 필드의 위치나 값이 함께 바뀌어 무엇이 무효화를 일으켰는지 흐려진다.
      const end = view.state.doc.content.size - 1;
      view.dispatch(view.state.tr.insertText("y", end, end));

      expect(view.state.doc.textContent).toContain("📅2026-08-30");
      expect(chip(rendered.host)?.classList.contains("task-chip-overdue")).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("§308 로케일 구독 — 동등성 관문 (리뷰 Minor 1)", () => {
  // ‼️ `view()`의 `if (state.locale === prev.locale) return;` 한 줄을 지켜본다.
  //
  // Zustand의 `subscribe`는 **모든** `set()`에 발화한다 — partial이 새 root가
  // 되므로 테마 토글·폰트 크기·태그 색 어느 것을 바꿔도 이 콜백이 불린다.
  // 관문이 없으면 그 하나하나가 문서 전체 데코레이션 재구축 + 전 칩 DOM 재생성을
  // 부른다. CLAUDE.md의 "고빈도 경로의 store write는 동등성 관문 필수"가
  // 가리키는 자리가 정확히 여기다.
  //
  // 관문이 **동작한다는 것**은 리뷰가 확인했지만 아무 테스트도 그것을 고정하지
  // 않았다(관문을 지워도 스위트 전체가 초록이었다). 그래서 타이밍이 아니라
  // dispatch **횟수**를 센다 — 프로젝트 규약이 요구하는 카운트 기반 고정이다.
  let view: EditorView | null = null;
  const theme = useSettingsStore.getState().theme;

  afterEach(() => {
    view?.destroy();
    view = null;
    useSettingsStore.setState({ locale: "en", theme });
  });

  it("로케일이 실제로 바뀔 때만 dispatch한다 — 다른 설정 write는 0회", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const doc = markdownToProsemirror("- [ ] 초안 📅2026-08-30\n\nx", schema);
    let dispatches = 0;
    // `dispatchTransaction`은 뷰를 `this`로 받지만 타입에 그것이 없어 홀더로 잡는다.
    const held: { view?: EditorView } = {};
    held.view = new EditorView(host, {
      dispatchTransaction(tr) {
        dispatches += 1;
        const v = held.view;
        if (v) v.updateState(v.state.apply(tr));
      },
      state: EditorState.create({
        doc,
        plugins: [createTaskFieldChipsPlugin()],
        schema,
        selection: Selection.atEnd(doc),
      }),
    });
    view = held.view;
    expect(dispatches).toBe(0);

    // 설정의 **다른** 키. 관문이 없으면 여기서 이미 1이 된다.
    useSettingsStore.setState({ theme: "dark" });
    expect(dispatches).toBe(0);

    // 로케일이지만 **같은 값**. zustand는 그래도 구독을 깨우므로 값 비교가 필요하다.
    useSettingsStore.setState({ locale: "en" });
    expect(dispatches).toBe(0);

    // 실제 전환에서만 딱 한 번.
    useSettingsStore.setState({ locale: "ko" });
    expect(dispatches).toBe(1);
    expect(chip(host)?.textContent).toBe("8/30 기한");
  });
});
