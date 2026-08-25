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
// 구조만 보는 테스트는 전부 초록이었다.

import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import {
  buildTaskFieldDecorations,
  RAW_CLASS,
  RAW_HIDE_CLASS,
  renderTaskChip,
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

const baseCss = readFileSync(
  join(process.cwd(), "src/styles/base.css"),
  "utf8",
);

const tasksCss = readFileSync(
  join(process.cwd(), "src/styles/tasks.css"),
  "utf8",
);

/** `.visually-hidden` 규칙 본문. */
function hideRule(): string {
  const match = new RegExp(`\\.${RAW_HIDE_CLASS}\\s*\\{([^}]*)\\}`).exec(
    baseCss,
  );
  expect(match, `no .${RAW_HIDE_CLASS} rule in base.css`).not.toBeNull();
  return match?.[1] ?? "";
}

function render(md: string): { host: HTMLElement; view: EditorView } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = markdownToProsemirror(md, schema);
  const state = EditorState.create({
    doc,
    plugins: [
      new Plugin({
        props: {
          // -1 = 어떤 항목도 건너뛰지 않는다(커서가 없는 상태의 화면).
          decorations: (s) => buildTaskFieldDecorations(s.doc, -1, TODAY),
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
    const body = hideRule();
    expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
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

  it("기본 칩은 아웃라인뿐 — 채움이 없어야 `.wikilink-date`와 갈라진다(§316)", () => {
    const body = /\.task-chip\s*\{([^}]*)\}/.exec(tasksCss)?.[1];
    expect(body, "no .task-chip rule").toBeDefined();
    expect(body).toMatch(/border:/);
    expect(body).not.toMatch(/background/);
  });

  it("우선순위 칩에는 색 전용 클래스를 붙이지 않는다", () => {
    // 규칙이 사라졌으므로 클래스도 사라져야 한다 — 남겨 두면 CSS에 없는
    // 클래스를 JS가 계속 뿌리게 된다.
    const el = renderTaskChip(
      { emoji: "⏫", from: 0, kind: "priority", to: 1, value: "⏫" },
      false,
    );
    expect([...el.classList]).toEqual(["task-chip"]);
  });
});

describe("§308 아젠다 배지와 에디터 칩의 정렬 (리뷰 m5)", () => {
  // Task 4의 산출물은 "복사가 아닌 규칙 공유"였다. 공유가 절반만 이뤄져도
  // (`.task-chip-priority` 누락) 잡히지 않았기에 두 표면이 다른 색으로 보였다.
  it("에디터 전용 `vertical-align`이 사이드바 행을 밀지 못한다", () => {
    // `.task-chip`의 `vertical-align: 1px`는 에디터의 인라인 흐름을 위한 것이다.
    // 사이드바에서 무효인 이유는 단 하나 — `.task-row`가 flex 컨테이너라
    // `.task-row-priority`가 flex item이 되기 때문이다. 그 전제가 깨지면
    // 이 속성이 배지를 1px 밀기 시작하므로 여기에 못박는다.
    const row = /\.task-row\s*\{([^}]*)\}/.exec(tasksCss)?.[1];
    expect(row, "no .task-row rule").toBeDefined();
    expect(row).toMatch(/display:\s*flex/);
    expect(/\.task-chip\s*\{([^}]*)\}/.exec(tasksCss)?.[1]).toMatch(
      /vertical-align:/,
    );
  });
});

describe("§308 칩의 접근성 계약", () => {
  it("칩은 aria-hidden이다 — 원문이 남아 있으므로 두 번 읽히면 안 된다", () => {
    // `renderTaskChip`의 doc 주석이 하중을 싣고 있던 계약인데 단언이 없었다.
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
    );
    expect(el.getAttribute("aria-hidden")).toBe("true");
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
