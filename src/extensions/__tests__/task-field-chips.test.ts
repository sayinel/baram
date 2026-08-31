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
import { renderTaskChip } from "../plugins/task-chip-label";
import { buildTaskFieldDecorations } from "../plugins/task-field-chips";

// ── 테스트용 스키마 ───────────────────────────────────────────────────
// `block-id-decoration.test.ts`와 같은 방식: 이 테스트가 실제로 쓰는 노드만
// 담은 최소 스키마를 만들고 `markdownToProsemirror(md, schema)`에 넘긴다.
//
// `wikilink`·`tagNode`·`mention`이 **반드시** 있어야 한다: `md-to-pm.ts:603,615`가
// 아톰 분리를 이 노드들의 존재로 게이트하므로, 없으면 `[[...]]`와 `#tag`가 그냥
// 텍스트로 남아 이 기능이 존재하는 이유인 아톰 오프셋 경로를 한 번도 지나지 않는다.
// 형태는 `src/pipeline/__tests__/md-to-pm-split.test.ts:16-99`를 그대로 따랐다.

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
    },
    listItem: { content: "paragraph block*" },
    taskList: { content: "taskItem+", group: "block" },
    taskItem: {
      content: "paragraph block*",
      attrs: { state: { default: "todo" } },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    // 리뷰 M3 — 차단 목록이 새던 형태들. `hasNodeType`은 **파이프라인**이 형태를
    // 못 만드는 헛돎만 막고, **스키마**에 그 노드가 없어 형태가 태어나지도 못하는
    // 경우는 막지 못한다. 콜아웃·표·헤딩이 여기 없었기 때문에 "중첩 블록은
    // 안전하다"가 네 개 노드 이름에 대해서만 증명된 채 전체로 단언됐다.
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    callout: {
      content: "block+",
      group: "block",
      attrs: {
        type: { default: "info" },
        title: { default: "" },
        collapsed: { default: false },
      },
    },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: {
      content: "paragraph+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
    tableHeader: {
      content: "paragraph+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
    wikilink: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: {
        target: { default: "" },
        display: { default: null },
        heading: { default: null },
        blockId: { default: null },
      },
    },
    mention: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: { type: { default: "page" }, value: { default: "" } },
    },
    tagNode: {
      atom: true,
      inline: true,
      group: "inline",
      attrs: { tag: { default: "" } },
    },
  },
  // 리뷰 M1 — `code`가 **반드시** 있어야 한다: `md-to-pm.ts:631-636`이 인라인
  // 코드를 `schema.marks.code?.create()`로 게이트하므로, 없으면 백틱 안이 그냥
  // 텍스트로 남아 이 마크 경로를 한 번도 지나지 않는다.
  marks: { bold: {}, code: { excludes: "_" }, italic: {} },
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

/**
 * 문서에 그 마크가 실제로 붙은 텍스트가 있는지.
 *
 * `hasNodeType`과 같은 이유의 장치다 — 스키마에 `code` 마크가 없으면 백틱이
 * 그냥 텍스트로 남아 "칩이 없다"가 저절로 통과한다.
 */
function hasMarkType(doc: PMNode, name: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.marks.some((m) => m.type.name === name)) found = true;
    return !found;
  });
  return found;
}

/**
 * 문서에 그 타입의 노드가 실제로 있는지.
 *
 * 중첩 블록·아톰 테스트가 **헛돌지 않게** 하는 장치다: 파이프라인이 그 형태를
 * 만들어내지 못하면 "칩이 없다"는 단언은 저절로 통과해버린다.
 */
function hasNodeType(doc: PMNode, name: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === name) found = true;
    return !found;
  });
  return found;
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

/** 첫 `taskItem` **자신의** 위치 — NodeSelection이 앉는 자리. */
function posOfFirstTaskItem(doc: PMNode): number {
  let first = -1;
  doc.descendants((node, pos) => {
    if (first === -1 && node.type.name === "taskItem") first = pos;
    return first === -1;
  });
  return first;
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

// ── 태스크 항목 **안**의 비-태스크 블록 (§316) ─────────────────────────
//
// `taskItem`의 content는 `paragraph block*`이라 코드블록·인용구·일반 불릿이
// 그 안에 들어올 수 있다. 그것들은 태스크 **줄**이 아니므로 우리 것이 아니다.

describe("buildTaskFieldDecorations — 중첩된 비-태스크 블록", () => {
  it("태스크 안의 코드블록 리터럴에는 칩을 그리지 않는다", () => {
    // 가장 나쁜 경우다: Task 3의 CSS가 원문을 감추는 순간 사용자가 쓴
    // 코드 한 줄에서 글자가 사라지고 그 위에 칩이 얹힌다.
    const md = ["- [ ] 할 일", "", "  ```", "  📅2026-08-30", "  ```"].join(
      "\n",
    );
    const doc = markdownToProsemirror(md, schema);
    expect(hasNodeType(doc, "codeBlock")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("태스크 안의 인용구에는 칩을 그리지 않는다", () => {
    const md = ["- [ ] 할 일", "", "  > 인용 📅2026-08-30"].join("\n");
    const doc = markdownToProsemirror(md, schema);
    expect(hasNodeType(doc, "blockquote")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("태스크 안의 일반 불릿에는 칩을 그리지 않는다", () => {
    const md = ["- [ ] 상위 할 일", "  - 메모 📅2026-08-30"].join("\n");
    const doc = markdownToProsemirror(md, schema);
    expect(hasNodeType(doc, "bulletList")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("비-태스크 블록을 끼고도 태스크 줄 자신의 칩은 그대로다", () => {
    const md = ["- [ ] 할 일 📅2026-08-30", "", "  > 인용 📅2026-09-01"].join(
      "\n",
    );
    const doc = markdownToProsemirror(md, schema);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([
      "📅2026-08-30",
    ]);
  });

  // 리뷰 M3 — 위의 네 케이스는 **차단 목록**에 이름이 적힌 것들이라 통과했다.
  // 사용자가 메모를 적을 때 실제로 쓰는 문법(`> [!note]`)은 파이프라인이 콜아웃으로
  // 바꾸므로 그 목록을 그대로 지나쳤다. 아래는 허용 목록(= 항목 자신의 태스크 줄만)이
  // 아니면 통과할 수 없는 형태들이다.

  it("태스크 안의 콜아웃에는 칩을 그리지 않는다", () => {
    // 실패 모양: 메모에 적은 "원래 마감"이 그 태스크 **자신의** 마감처럼 보인다.
    const md = [
      "- [ ] 릴리스 준비",
      "",
      "  > [!note]",
      "  > 원래 마감은 📅2026-08-30 이었다",
    ].join("\n");
    const doc = markdownToProsemirror(md, schema);
    expect(hasNodeType(doc, "callout")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("태스크 안의 표 셀에는 칩을 그리지 않는다", () => {
    const md = [
      "- [ ] 할 일",
      "",
      "  | 메모 |",
      "  | --- |",
      "  | 참고 📅2026-08-30 |",
    ].join("\n");
    const doc = markdownToProsemirror(md, schema);
    expect(hasNodeType(doc, "table")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("태스크 안의 헤딩에는 칩을 그리지 않는다", () => {
    const md = ["- [ ] 할 일", "", "  # 제목 📅2026-08-30"].join("\n");
    const doc = markdownToProsemirror(md, schema);
    expect(hasNodeType(doc, "heading")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("항목의 두 번째 문단(이어 적은 메모)에도 칩을 그리지 않는다", () => {
    // 태스크 **줄**은 항목의 첫 문단이다. Rust 인덱서(`task/parse.rs:8-9`)도
    // `- [ ]`로 시작하는 그 한 줄만 파싱하므로, 이어 적은 문단의 날짜는 아젠다에
    // 이 태스크의 마감으로 잡히지 않는다 — 칩을 그리면 에디터만 없는 사실을
    // 말하게 된다.
    const md = ["- [ ] 할 일", "", "  이어 적은 메모 📅2026-08-30"].join("\n");
    const doc = markdownToProsemirror(md, schema);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });
});

// ── 인라인 코드 (리뷰 M1) ──────────────────────────────────────────────
//
// 인라인 코드는 **별도 노드가 아니라** `code` 마크가 붙은 텍스트 노드다
// (`md-to-pm.ts:631-636`). 텍스트 런을 마크를 보지 않고 이어 붙이면 백틱 안의
// 필드가 본문과 똑같이 스캔되고, 원문이 감춰진 자리에 코드가 아닌 칩이 나타난다.
// 이 앱의 태스크 문법을 문서로 정리하는 사용자가 자기가 쓴 글자를 잃는 자리다.
// `collectItem`이 **블록** 코드에 대해 이미 막아 둔 것과 같은 손실이다.

describe("buildTaskFieldDecorations — 인라인 코드", () => {
  it("백틱 안의 날짜 필드에는 칩을 그리지 않는다", () => {
    const doc = markdownToProsemirror(
      "- [ ] 할 일 `📅2026-08-30` 참고",
      schema,
    );
    expect(hasMarkType(doc, "code")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("백틱 안의 우선순위 마커에도 칩을 그리지 않는다", () => {
    const doc = markdownToProsemirror("- [ ] 문서에 `⏫` 를 쓰는 법", schema);
    expect(hasMarkType(doc, "code")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });

  it("코드를 끼고도 앞뒤 필드의 구간은 정확하다", () => {
    // 코드에서 런을 **끊는** 것이지 글자만 빼는 것이 아니다. 빼기만 하면 뒤
    // 런의 오프셋이 코드 길이만큼 밀려 칩이 사용자가 쓴 글자를 덮는다.
    const doc = markdownToProsemirror(
      "- [ ] 초안 🛫2026-08-25 `📅2026-09-09` 📅2026-08-30",
      schema,
    );
    expect(hasMarkType(doc, "code")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([
      "🛫2026-08-25",
      "📅2026-08-30",
    ]);
  });

  it("필드가 코드 경계를 가로질러 이어지지 않는다", () => {
    // hardBreak에서 이미 본 실패 모양의 마크 판이다: 이모지는 본문에, 날짜는
    // 코드 안에 있는데 런이 이어지면 한 필드로 붙어 코드까지 통째로 덮는다.
    const doc = markdownToProsemirror("- [ ] 초안 ⏳`2026-08-27`", schema);
    expect(hasMarkType(doc, "code")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([]);
  });
});

// ── 인라인 아톰 (이 기능이 존재하는 형태) ──────────────────────────────

describe("buildTaskFieldDecorations — 인라인 아톰", () => {
  it("스펙 예시 줄에서 구간이 정확하다 — 위키링크 + 태그 + 필드 셋", () => {
    // 아톰은 문자를 0개 내놓으면서 위치는 한 칸 차지한다. `textContent`를
    // 훑으면 아톰 하나당 정확히 한 칸씩 밀린다.
    const md =
      "- [ ] 태스크 본문 [[202607051530]] #deep-work 🛫2026-08-25 📅2026-08-30 ⏫";
    const doc = markdownToProsemirror(md, schema);
    // 스키마에 노드가 없으면 파이프라인이 아톰을 만들지 않는다 — 그러면 이
    // 테스트는 아톰 경로를 지나지 않은 채 통과해버린다.
    expect(hasNodeType(doc, "wikilink")).toBe(true);
    // 이 줄에서 `#deep-work`는 텍스트로 남는다: `md-to-pm.ts:602-620`의 분리기들이
    // 하나가 노드를 만들면 곧바로 반환하므로, 위키링크가 걸린 텍스트에는 태그
    // 분리가 아예 돌지 않는다. 태그 아톰 경로는 아래 "아톰이 필드 사이에" 테스트가
    // 따로 지킨다.
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([
      "🛫2026-08-25",
      "📅2026-08-30",
      "⏫",
    ]);
  });

  it("멘션 아톰이 앞에 있어도 구간이 정확하다", () => {
    const doc = markdownToProsemirror(
      "- [ ] 초안 @[[홍길동]] 📅2026-08-30",
      schema,
    );
    expect(hasNodeType(doc, "mention")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([
      "📅2026-08-30",
    ]);
  });

  it("아톰이 필드 **사이**에 있어도 각 구간이 정확하다", () => {
    const doc = markdownToProsemirror(
      "- [ ] 초안 🛫2026-08-25 #deep-work 📅2026-08-30",
      schema,
    );
    expect(hasNodeType(doc, "tagNode")).toBe(true);
    expect(covered(doc, buildTaskFieldDecorations(doc, -1, TODAY))).toEqual([
      "🛫2026-08-25",
      "📅2026-08-30",
    ]);
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

  it("taskItem 자체를 노드 선택해도 데코레이션을 넣지 않는다", () => {
    // NodeSelection은 `from`을 그 항목 **자신의** 위치에 둔다 — 그 위치를
    // resolve한 조상 사슬에는 항목이 없으므로 조상 탐색만으로는 놓친다.
    const doc = markdownToProsemirror("- [ ] 초안 📅2026-08-30", schema);
    const itemPos = posOfFirstTaskItem(doc);
    expect(doc.nodeAt(itemPos)?.type.name).toBe("taskItem");
    expect(buildTaskFieldDecorations(doc, itemPos, TODAY).find()).toHaveLength(
      0,
    );
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

// ── 칩 DOM (방향 C — 점 + 텍스트, §308) ─────────────────────────────────
//
// 이모지는 더 이상 DOM에 나타나지 않는다. 라벨의 언어는 **인자**로 들어온다:
// `buildTaskFieldDecorations`가 진입점에서 store를 한 번 읽어 아래로 넘기므로
// (`task-chip-label.ts`), 이 층은 store를 전혀 모른다. store에서 라벨까지
// 실제로 이어지는지는 렌더 테스트의 로케일 구독·동등성 관문 스위트가 지킨다.

/** 칩의 기준일 — 픽스처 날짜(2026-08-*)와 같은 해라 연도는 접힌다. */
const CHIP_TODAY = new Date(2026, 7, 25);

describe("renderTaskChip", () => {
  it("날짜 라벨과 연도를 접은 날짜를 보인다 — 이모지는 사라진다", () => {
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
      "en",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe("due 8/30");
    expect(el.classList.contains("task-chip-overdue")).toBe(false);
  });

  it("올해가 아니면 연도를 보인다 — 감추면 날짜가 거짓말을 한다", () => {
    // ‼️ 실제로 겪은 오해다: `📅2027-08-25`가 `8/25 기한`으로 보여 사용자가 그것을 기한
    // 초과로 읽었고, 아젠다가 "나중"에 넣은 것을 버킷 분류의 결함으로 의심했다. 화면이
    // 감춘 그 한 조각이 어느 버킷인지를 정하는 값이었다.
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2027-08-25" },
      false,
      "en",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe("due 2027/8/25");
  });

  it("지난 해도 연도를 보인다 — 미래만의 문제가 아니다", () => {
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2025-12-31" },
      true,
      "ko",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe("2025/12/31 기한");
  });

  it("연도 표시와 기한 초과 색이 같은 시계를 본다", () => {
    // 둘 다 `today`에서 온다. 각자 다른 시계를 보면 "빨간데 연도가 없다"처럼 서로를
    // 배반하는 칩이 생긴다 — 그 조합은 사용자가 무엇을 믿어야 할지 알 수 없게 만든다.
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-20" },
      true,
      "en",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe("due 8/20");
    expect(el.classList.contains("task-chip-overdue")).toBe(true);
  });

  it("로케일이 ko이면 어순이 바뀐다(날짜가 먼저, 라벨이 뒤)", () => {
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
      "ko",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe("8/30 기한");
  });

  it("마감이 지나면 overdue 클래스를 더한다", () => {
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-20" },
      true,
      "en",
      CHIP_TODAY,
    );
    expect(el.classList.contains("task-chip-overdue")).toBe(true);
  });

  it("우선순위 칩은 텍스트 라벨을 보인다 — 마커 자체는 그려지지 않는다", () => {
    const el = renderTaskChip(
      { emoji: "⏫", from: 0, kind: "priority", to: 1, value: "⏫" },
      false,
      "en",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe("high");
    // 색 전용 클래스는 붙지 않는다 — 색을 갖는 상태는 기한 초과뿐이다
    // (방향 A 때부터 이어진 원칙, `task-field-chips-render.test.ts`).
    expect(el.classList.contains("task-chip-overdue")).toBe(false);
  });

  it("칩은 키를 받지 않는다 — data-vim-suspend를 붙이지 않는다", () => {
    // 붙이면 vim 플러그인이 이 줄에서 키 소유권을 넘겨 타이핑이 사라진다.
    const el = renderTaskChip(
      { emoji: "📅", from: 0, kind: "due", to: 12, value: "2026-08-30" },
      false,
      "en",
      CHIP_TODAY,
    );
    expect(el.hasAttribute("data-vim-suspend")).toBe(false);
    expect(el.contentEditable).toBe("false");
  });
});

describe("renderTaskChip — 우선순위 마커 → 라벨 매핑", () => {
  // PRIORITY_EMOJI("1"=🔺 최고 / "2"=⏫ 높음 / "4"=🔽 낮음 / "5"=⏬ 최저)의
  // 네 마커가 각각 옳은 i18n 키로 간다. "3"(보통)은 마커가 없어 scanTaskFields가
  // 애초에 span을 만들지 않으므로 여기 없다.
  it.each([
    ["🔺", "urgent"],
    ["⏫", "high"],
    ["🔽", "low"],
    ["⏬", "lowest"],
  ])("%s 마커는 %s 라벨을 읽는다", (marker, label) => {
    const el = renderTaskChip(
      {
        emoji: marker,
        from: 0,
        kind: "priority",
        to: marker.length,
        value: marker,
      },
      false,
      "en",
      CHIP_TODAY,
    );
    expect(el.textContent).toBe(label);
  });
});
