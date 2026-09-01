// 이슈 498 — 모달이 캡처한 target이 stale이 된 뒤의 applyTargetLine.
//
// target(pos, node)은 모달이 열릴 때 한 번 캡처된다. 모달이 떠 있는 동안에도 전역
// 키보드 dispatch·외부 리로드가 문서를 바꿀 수 있으므로, 저장 시점의 splice 범위
// `pos ~ pos + node.nodeSize`가 아직 유효하다는 보장이 없다. 가드 전에는 stale 범위가
// 다음 블록 머리를 잘라먹거나(silent data loss) 문서 끝에서 out-of-range로 던졌다.
//
// 가드는 ProseMirror 노드 불변성에 기댄다: 문서가 target을 건드리지 않았다면 구조
// 공유로 `doc.nodeAt(pos) === node`가 유지되고(뒤쪽 편집 포함 — T5), 건드렸다면
// identity가 깨져 no-op이 된다. "문서를 반쯤 바꿔 놓느니 아무 일도 일어나지 않는
// 편이 낫다"는 이 함수의 기존 계약 그대로다.
import type { TaskEditTarget } from "../task-edit-target";

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { applyTargetLine } from "../task-edit-io";
import { resolveTaskEditTarget } from "../task-edit-target";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function markdown(ed: Editor): string {
  return prosemirrorToMarkdown(ed.state.doc).trim();
}

function openAndCapture(
  md: string,
  cursorInto: string,
): { editor: Editor; target: TaskEditTarget } {
  editor = new Editor({ extensions: createBaramExtensions(), content: "" });
  const doc = markdownToProsemirror(md, editor.state.schema);
  editor.commands.setContent(doc.toJSON() as never);

  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(cursorInto)) {
      at = pos + 1;
    }
    return at === -1;
  });
  if (at === -1) throw new Error(`cursor anchor not found: ${cursorInto}`);
  editor.commands.setTextSelection(at);

  const target = resolveTaskEditTarget(editor);
  if (!target) throw new Error("no target resolved");
  return { editor, target };
}

describe("applyTargetLine — stale target guard (이슈 498)", () => {
  it("T1 문서가 안 바뀌었으면 이전과 똑같이 저장된다", () => {
    const { editor: ed, target } = openAndCapture(
      "- [ ] 원래 할 일\n\n뒷문단",
      "원래",
    );
    expect(applyTargetLine(ed, target, "고친 할 일")).toBe(true);
    expect(markdown(ed)).toContain("- [ ] 고친 할 일");
    expect(markdown(ed)).toContain("뒷문단");
  });

  it("T2 캡처 후 앞쪽 편집으로 pos가 밀리면 no-op — 인접 내용을 잘라먹지 않는다", () => {
    const { editor: ed, target } = openAndCapture(
      "앞 문단\n\n- [ ] 할 일\n\n뒷문단",
      "할 일",
    );
    // 모달이 떠 있는 동안 앞 문단이 자란다 → 캡처된 pos는 이제 다른 자리를 가리킨다.
    ed.commands.insertContentAt(1, "길어진 ");
    const before = markdown(ed);

    expect(applyTargetLine(ed, target, "고친 할 일")).toBe(false);
    expect(markdown(ed)).toBe(before);
  });

  it("T3 문서가 줄어 범위가 밖으로 나가면 throw 없이 false", () => {
    const { editor: ed, target } = openAndCapture(
      "앞 문단\n\n- [ ] 마지막 할 일",
      "마지막",
    );
    // 문서 전체를 짧은 한 문단으로 교체 — 캡처된 pos+nodeSize가 범위 밖이 된다.
    const tiny = markdownToProsemirror("짧다", ed.state.schema);
    ed.commands.setContent(tiny.toJSON() as never);
    const before = markdown(ed);

    let result: boolean | undefined;
    expect(() => {
      result = applyTargetLine(ed, target, "고친 할 일");
    }).not.toThrow();
    expect(result).toBe(false);
    expect(markdown(ed)).toBe(before);
  });

  it("T4 같은 내용이라도 문서가 재파싱됐으면(리로드) no-op", () => {
    const md = "- [ ] 할 일\n\n뒷문단";
    const { editor: ed, target } = openAndCapture(md, "할 일");
    // 외부 리로드: 내용은 같아도 모든 노드가 새 객체다.
    const reloaded = markdownToProsemirror(md, ed.state.schema);
    ed.commands.setContent(reloaded.toJSON() as never);
    const before = markdown(ed);

    expect(applyTargetLine(ed, target, "고친 할 일")).toBe(false);
    expect(markdown(ed)).toBe(before);
  });

  it("T5 타깃 뒤쪽만 편집됐으면 구조 공유로 identity가 살아 저장이 계속 된다", () => {
    const { editor: ed, target } = openAndCapture(
      "- [ ] 할 일\n\n뒷문단",
      "할 일",
    );
    // 문서 끝에 덧붙이는 편집 — 타깃 앞 좌표는 그대로, 노드도 같은 객체로 남는다.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " 추가");

    // 구조 공유가 실제로 identity를 지켰음을 명시한다 — 이게 이 테스트의 전제다.
    expect(ed.state.doc.nodeAt(target.pos)).toBe(target.node);
    expect(applyTargetLine(ed, target, "고친 할 일")).toBe(true);
    expect(markdown(ed)).toContain("- [ ] 고친 할 일");
    expect(markdown(ed)).toContain("뒷문단 추가");
  });
});
