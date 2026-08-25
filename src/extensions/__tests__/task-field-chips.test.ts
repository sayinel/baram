// §308 표시 절반 — 데코레이션이 덮는 구간이 **정확히** 이모지 필드인지 본다.
//
// 이 파일의 중심은 개수 세기가 아니라 위치 검증이다. 오프셋이 한 칸만 어긋나도
// 칩이 사용자가 쓴 글자를 덮는다. 그래서 거의 모든 테스트가 `doc.textBetween`으로
// 구간을 다시 읽어 원문과 대조한다.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration, DecorationSet } from "@tiptap/pm/view";

import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import {
  buildTaskFieldDecorations,
  renderTaskChip,
} from "../plugins/task-field-chips";

// ── 테스트용 스키마 ───────────────────────────────────────────────────
// `block-id-decoration.test.ts`와 같은 방식: 이 테스트가 실제로 쓰는 노드만
// 담은 최소 스키마를 만들고 `markdownToProsemirror(md, schema)`에 넘긴다.

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    taskList: { content: "taskItem+", group: "block" },
    taskItem: {
      content: "paragraph block*",
      attrs: { checked: { default: false } },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: { bold: {}, italic: {} },
});

const TODAY = new Date(2026, 7, 25); // 2026-08-25

function build(md: string, selectionFrom = -1): DecorationSet {
  return buildTaskFieldDecorations(
    markdownToProsemirror(md, schema),
    selectionFrom,
    TODAY,
  );
}

/** 각 데코레이션이 실제로 덮는 문서 텍스트. */
function covered(doc: PMNode, set: DecorationSet): string[] {
  return inlineDecos(set).map((d) => doc.textBetween(d.from, d.to));
}

function decoCount(md: string, selectionFrom = -1): number {
  return build(md, selectionFrom).find().length;
}

/** 구간을 덮는 데코레이션(`from < to`)만. 위젯은 `from === to`다. */
function inlineDecos(set: DecorationSet): Decoration[] {
  return set
    .find()
    .filter((d) => d.from < d.to)
    .sort((a, b) => a.from - b.from);
}

/** 문서의 마지막 `taskItem` 문단 안쪽 위치 — 중첩 커서 테스트용. */
function posInLastTaskItem(doc: PMNode): number {
  let last = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") last = pos;
    return true;
  });
  return last + 2;
}

function widgetDecos(set: DecorationSet): Decoration[] {
  return set
    .find()
    .filter((d) => d.from === d.to)
    .sort((a, b) => a.from - b.from);
}

// ── 개수 계약 ─────────────────────────────────────────────────────────

describe("buildTaskFieldDecorations — 개수", () => {
  it("태스크 줄의 필드마다 숨김 + 칩 두 개를 만든다", () => {
    expect(decoCount("- [ ] 초안 📅2026-08-30")).toBe(2);
  });

  it("필드가 셋이면 여섯 개", () => {
    expect(decoCount("- [ ] 초안 🛫2026-08-25 ⏳2026-08-27 📅2026-08-30")).toBe(
      6,
    );
  });

  it("일반 문단의 날짜 이모지는 건드리지 않는다", () => {
    // §316 — 자리가 의미를 결정한다. 태스크 밖의 날짜는 그냥 글자다.
    expect(decoCount("초안 📅2026-08-30")).toBe(0);
  });

  it("태스크가 아닌 목록 항목도 건드리지 않는다", () => {
    expect(decoCount("- 초안 📅2026-08-30")).toBe(0);
  });

  it("필드가 없는 태스크 줄은 데코레이션이 없다", () => {
    expect(decoCount("- [ ] 그냥 할 일")).toBe(0);
  });

  it("값이 뒤따르지 않는 이모지는 숨기지 않는다", () => {
    expect(decoCount("- [ ] 오늘 📅 회의 잡기")).toBe(0);
  });
});

// ── 위치 검증 (이 태스크의 핵심) ───────────────────────────────────────

describe("buildTaskFieldDecorations — 위치", () => {
  it("숨기는 구간이 실제 이모지 필드와 정확히 일치한다", () => {
    const doc = markdownToProsemirror("- [ ] 보고서 초안 📅2026-08-30", schema);
    const set = buildTaskFieldDecorations(doc, -1, TODAY);
    expect(covered(doc, set)).toEqual(["📅2026-08-30"]);
  });

  it("한글 본문·여러 필드·중첩 태스크에서도 구간이 정확하다", () => {
    const md =
      "- [ ] 보고서 초안 🛫2026-08-25 ⏳2026-08-27 📅2026-08-30 ⏫\n" +
      "  - [ ] 자료 조사 📅2026-08-26";
    const doc = markdownToProsemirror(md, schema);
    const set = buildTaskFieldDecorations(doc, -1, TODAY);
    expect(covered(doc, set)).toEqual([
      "🛫2026-08-25",
      "⏳2026-08-27",
      "📅2026-08-30",
      "⏫",
      "📅2026-08-26",
    ]);
  });

  it("굵게 표시된 본문이 섞여도 구간이 정확하다", () => {
    // 마크 경계 때문에 문단이 텍스트 노드 여럿으로 쪼개진다 — 인접한 텍스트
    // 노드를 이어 붙여야 오프셋이 맞는다.
    const doc = markdownToProsemirror(
      "- [ ] **보고서** 초안 📅2026-08-30",
      schema,
    );
    const set = buildTaskFieldDecorations(doc, -1, TODAY);
    expect(covered(doc, set)).toEqual(["📅2026-08-30"]);
  });

  it("칩 위젯은 숨긴 구간 바로 뒤에 놓인다", () => {
    const set = build("- [ ] 초안 📅2026-08-30");
    expect(widgetDecos(set).map((d) => d.from)).toEqual(
      inlineDecos(set).map((d) => d.to),
    );
  });

  it("하드 브레이크를 넘어 필드가 이어지지 않는다", () => {
    // Ruling E — `textContent`는 hardBreak를 **빈 문자열**로 내놓으면서 위치는
    // 한 칸 차지한다. 그대로 훑으면 (1) ⏳와 다음 줄 날짜가 한 필드로 붙고
    // (2) 그 뒤 필드의 오프셋이 한 칸씩 밀린다.
    const md = "- [ ] 초안 ⏳  \n  2026-08-27 📅2026-08-30";
    const doc = markdownToProsemirror(md, schema);
    const set = buildTaskFieldDecorations(doc, -1, TODAY);
    expect(covered(doc, set)).toEqual(["📅2026-08-30"]);
  });
});

// ── 커서 계약 ─────────────────────────────────────────────────────────

describe("buildTaskFieldDecorations — 커서", () => {
  it("커서가 그 taskItem 안에 있으면 데코레이션을 넣지 않는다", () => {
    const doc = markdownToProsemirror("- [ ] 초안 📅2026-08-30", schema);
    expect(buildTaskFieldDecorations(doc, 4, TODAY).find()).toHaveLength(0);
  });

  it("커서가 중첩 태스크에 있으면 바깥 태스크의 칩은 남는다", () => {
    const md = "- [ ] 보고서 초안 📅2026-08-30\n  - [ ] 자료 조사 📅2026-08-26";
    const doc = markdownToProsemirror(md, schema);
    const set = buildTaskFieldDecorations(doc, posInLastTaskItem(doc), TODAY);
    expect(covered(doc, set)).toEqual(["📅2026-08-30"]);
  });

  it("커서가 다른 태스크에 있으면 이 태스크의 칩은 남는다", () => {
    const md = "- [ ] 초안 📅2026-08-30\n- [ ] 검토 📅2026-09-01";
    const doc = markdownToProsemirror(md, schema);
    const set = buildTaskFieldDecorations(doc, 4, TODAY);
    expect(covered(doc, set)).toEqual(["📅2026-09-01"]);
  });
});

// ── 마감 지남 ─────────────────────────────────────────────────────────

describe("buildTaskFieldDecorations — 마감 지남", () => {
  it("오늘보다 과거인 마감만 overdue로 표시한다", () => {
    const set = build("- [ ] 초안 📅2026-08-20");
    expect(widgetDecos(set)[0].spec.overdue).toBe(true);
  });

  it("오늘 마감은 overdue가 아니다", () => {
    const set = build("- [ ] 초안 📅2026-08-25");
    expect(widgetDecos(set)[0].spec.overdue).toBe(false);
  });

  it("마감이 아닌 필드는 과거여도 overdue가 아니다", () => {
    const set = build("- [ ] 초안 🛫2026-01-01");
    expect(widgetDecos(set)[0].spec.overdue).toBe(false);
  });
});

// ── 칩 DOM ────────────────────────────────────────────────────────────

describe("renderTaskChip", () => {
  it("이모지와 연도를 접은 날짜를 보인다", () => {
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
    );
    expect(el.textContent).toBe("📅8/30");
    expect(el.classList.contains("task-chip-overdue")).toBe(false);
  });

  it("마감이 지나면 overdue 클래스를 더한다", () => {
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-20" },
      true,
    );
    expect(el.classList.contains("task-chip-overdue")).toBe(true);
  });

  it("우선순위 칩은 마커만 보인다", () => {
    const el = renderTaskChip(
      { emoji: "⏫", from: 0, kind: "priority", to: 1, value: "⏫" },
      false,
    );
    expect(el.textContent).toBe("⏫");
    expect(el.classList.contains("task-chip-priority")).toBe(true);
  });

  it("칩은 키를 받지 않는다 — data-vim-suspend를 붙이지 않는다", () => {
    // 붙이면 vim 플러그인이 이 줄에서 키 소유권을 넘겨 타이핑이 사라진다.
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
    );
    expect(el.hasAttribute("data-vim-suspend")).toBe(false);
    expect(el.contentEditable).toBe("false");
  });
});
