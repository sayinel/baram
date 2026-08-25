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

import { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, Selection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import {
  buildTaskFieldDecorations,
  createTaskFieldChipsPlugin,
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
    );
    expect([...el.classList]).toEqual(["task-chip"]);
  });
});

describe("§308 방향 C — 아젠다 배지는 더 이상 .task-chip을 공유하지 않는다 (리뷰 m5 뒤집기)", () => {
  // 방향 A의 산출물은 "복사가 아닌 규칙 공유"(`.task-row-priority.task-chip`)였다.
  // 방향 C는 알약 자체를 없애므로 그 공유가 끝난다 — `TaskBucketList`는 이제
  // `task-row-priority` 하나만 붙이고, 조용한 타이포그래피를 스스로 갖는다.
  it(".task-row-priority가 .task-chip과 무관하게 자신의 색을 직접 선언한다", () => {
    const row = /\.task-row-priority\s*\{([^}]*)\}/.exec(tasksCss)?.[1];
    expect(row, "no .task-row-priority rule").toBeDefined();
    expect(row).toMatch(/color:\s*var\(--color-text-muted\)/);
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
