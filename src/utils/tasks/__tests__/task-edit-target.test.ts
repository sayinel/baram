// M2-b4 편집 모달의 대상 판정 + 블록 ↔ 마크다운 왕복.
//
// 실제 에디터를 세운다. 가드가 문자열 집합이라 이름이 하나만 어긋나도 **조용히 아무것도
// 막지 않고**, 그건 가드가 없는 것과 구별되지 않는다. 그리고 위키링크가 살아남는지는
// 진짜 노드를 만들어 보지 않으면 알 수 없다 — 평문으로 시험하면 언제나 통과한다.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { getSyntaxRevealExpanded } from "../../../extensions/plugins/syntax-reveal";
import { applyTargetLine, readTargetLine } from "../task-edit-io";
import { resolveTaskEditTarget } from "../task-edit-target";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function withMarkdown(markdown: string): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: createBaramExtensions(),
  });
  const { markdownToProsemirror } = mdToPm;
  const doc = markdownToProsemirror(markdown, editor.state.schema);
  editor.commands.setContent(doc.toJSON() as never);
  return editor;
}

/** 문서의 첫 텍스트 위치에 커서를 둔다. */
function caretAtFirstText(ed: Editor): void {
  let at = -1;
  ed.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText) at = pos + 1;
    return at === -1;
  });
  ed.commands.setTextSelection(at);
}

/** 지금 문서를 마크다운으로. */
function toMarkdown(ed: Editor): string {
  return pmToMd.prosemirrorToMarkdown(ed.state.doc).trim();
}

import * as mdToPm from "../../../pipeline/md-to-pm";
import * as pmToMd from "../../../pipeline/pm-to-md";

describe("resolveTaskEditTarget", () => {
  it("코드블록 안에서는 대상이 없다", () => {
    const ed = withMarkdown("```\n- [ ] x\n```");
    caretAtFirstText(ed);
    expect(resolveTaskEditTarget(ed)).toBeNull();
  });

  it("제목 안에서는 대상이 없다", () => {
    const ed = withMarkdown("# 제목");
    caretAtFirstText(ed);
    expect(resolveTaskEditTarget(ed)).toBeNull();
  });

  it("에디터가 없으면 대상이 없다", () => {
    expect(resolveTaskEditTarget(null)).toBeNull();
  });

  it("문단이면 아직 태스크가 아니다", () => {
    const ed = withMarkdown("초안 쓰기");
    caretAtFirstText(ed);
    expect(resolveTaskEditTarget(ed)?.isTask).toBe(false);
  });

  it("커서가 문장 중간이어도 같은 블록을 가리킨다", () => {
    // 커서 위치로 결과가 갈리면 사용자가 키를 누르기 전에 커서를 어디 뒀는지 기억해야
    // 한다 — 이 모달의 존재 이유와 정면으로 어긋난다.
    const ed = withMarkdown("초안 쓰기");
    caretAtFirstText(ed);
    const first = resolveTaskEditTarget(ed)?.pos;
    ed.commands.setTextSelection(3);
    expect(resolveTaskEditTarget(ed)?.pos).toBe(first);
  });

  it("태스크 항목이면 항목 전체를 가리키고 상태를 읽는다", () => {
    const ed = withMarkdown("- [x] 끝난 것 ✅2026-08-22");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed);
    expect(t?.isTask).toBe(true);
    expect(t?.state).toBe("done");
    expect(t?.node.type.name).toBe("taskItem");
  });

  // §18.18 M4 — 확장 상태도 그대로 읽혀야 한다. `checked` 불리언이던 시절에는
  // `[/]`가 "완료 아님"으로 뭉개져 저장할 때 `- [ ]`로 되돌아갔다.
  it("진행 중 항목의 상태를 잃지 않는다", () => {
    const ed = withMarkdown("- [/] 하는 중");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed);
    expect(t?.isTask).toBe(true);
    expect(t?.state).toBe("doing");
  });
});

describe("readTargetLine", () => {
  it("태스크는 `- [ ] ` 접두를 뗀 나머지를 준다", () => {
    const ed = withMarkdown("- [ ] 초안 📅2026-08-30 ⏫");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    expect(readTargetLine(ed.state, t)).toBe("초안 📅2026-08-30 ⏫");
  });

  it("위키링크가 살아남는다", () => {
    // ‼️ 이 테스트가 이 모듈이 파이프라인을 타는 유일한 이유다. `textBetween`으로
    // 읽으면 인라인 atom 노드가 공백 하나가 되어 링크가 조용히 사라진다.
    const ed = withMarkdown("- [ ] [[202607051530]] 절 쓰기 📅2026-08-30");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    expect(readTargetLine(ed.state, t)).toBe(
      "[[202607051530]] 절 쓰기 📅2026-08-30",
    );
  });

  it("문단은 그대로 준다", () => {
    const ed = withMarkdown("초안 쓰기");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    expect(readTargetLine(ed.state, t)).toBe("초안 쓰기");
  });

  // §384: opening the modal while the caret rests inside a mark that SyntaxReveal
  // has expanded to literal delimiter text (e.g. **bold**) must still read the
  // COLLAPSED line — not the literal text, which the pipeline would otherwise
  // escape a second time.
  it("§384: caret inside an expanded mark reads the collapsed line, not literal delimiters", () => {
    const ed = withMarkdown("- [ ] **bold** work 📅2026-08-30");
    caretAtFirstText(ed);

    let boldPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (boldPos === -1 && node.isText && node.text?.includes("bold")) {
        boldPos = pos + 1;
      }
      return boldPos === -1;
    });
    expect(boldPos).toBeGreaterThan(-1);
    ed.commands.setTextSelection(boldPos);

    // Expansion actually happened — otherwise this test proves nothing.
    expect(getSyntaxRevealExpanded(ed.state)).not.toBeNull();

    const t = resolveTaskEditTarget(ed)!;
    expect(readTargetLine(ed.state, t)).toBe("**bold** work 📅2026-08-30");
  });
});

describe("applyTargetLine", () => {
  it("태스크의 필드를 갈아끼운다", () => {
    const ed = withMarkdown("- [ ] 초안 📅2026-08-30");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    expect(applyTargetLine(ed, t, "초안 📅2026-09-01 ⏫")).toBe(true);
    expect(toMarkdown(ed)).toBe("- [ ] 초안 📅2026-09-01 ⏫");
  });

  it("체크 상태를 그대로 돌려준다 — 상태 전이는 이 모달의 일이 아니다", () => {
    const ed = withMarkdown("- [x] 끝난 것 ✅2026-08-22");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    applyTargetLine(ed, t, "끝난 것 ✅2026-08-22 ⏫");
    expect(toMarkdown(ed)).toBe("- [x] 끝난 것 ✅2026-08-22 ⏫");
  });

  it("문단은 태스크가 된다 — 리스트 안에 리스트를 만들지 않는다", () => {
    const ed = withMarkdown("초안 쓰기");
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    expect(applyTargetLine(ed, t, "초안 쓰기 📅2026-08-30")).toBe(true);
    expect(toMarkdown(ed)).toBe("- [ ] 초안 쓰기 📅2026-08-30");
  });

  it("아무것도 고치지 않고 저장하면 문서가 그대로다", () => {
    // 모달이 "열어 보기만 해도 문서가 바뀌는" 도구가 되면 미리보기로도 가려지지 않는다 —
    // 사용자는 바뀐 줄을 자기가 바꾼 것으로 읽는다.
    const source = "- [ ] [[202607051530]] 절 쓰기 #deep-work 📅2026-08-30 ⏫";
    const ed = withMarkdown(source);
    caretAtFirstText(ed);
    const t = resolveTaskEditTarget(ed)!;
    applyTargetLine(ed, t, readTargetLine(ed.state, t));
    expect(toMarkdown(ed)).toBe(source);
  });
});
