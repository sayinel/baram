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
