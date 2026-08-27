// §5.4 code block → ProseMirror escape helpers — extracted from the NodeView
// so initCM reads as lifecycle. Both are needed by the boundary keymap and
// by vim's island boundary handler, so they are built once per CM instance.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView as PMView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { focusEditorView } from "../../../utils/editor/focus-editor-view";

/** issue 478 — 이탈에 실릴 vim 훅. 이 모듈은 vim을 모른다(퀄리티 리뷰
 *  M1): 모드 캡처·메타 구성·인접 island 인계는 전부 소유자(NodeView)가
 *  주입한다. `stamp`는 선택 이동과 SAME 트랜잭션에 타는 경계 메타,
 *  `handoff`는 dispatch 후 착지가 다른 코드블록일 때의 명시적 진입
 *  (insert 의도 포함) — true를 돌려주면 PM 포커스 폴백을 생략한다. */
export interface CodeBlockEscape {
  /** Focus PM even while non-editable (vim modal). */
  focusPM(): void;
  /** Leave the block toward the PM neighbour (-1 up, 1 down). issue 478 —
   *  훅의 stamp는 선택 이동과 SAME 트랜잭션에 탄다(원자적·성공 결합 —
   *  getPos 부재로 no-op이 된 이탈은 바깥 모드를 바꾸지 않는다). */
  maybeEscape(dir: -1 | 1, exit?: EscapeExitHooks): void;
}

export interface EscapeExitHooks {
  handoff?(): boolean;
  stamp?(tr: Transaction): void;
}

export function createCodeBlockEscape(
  view: PMView,
  getPos: () => number | undefined,
  node: () => PMNode,
): CodeBlockEscape {
  const focusPM = () => {
    focusEditorView(view);
  };

  // Helper to exit CodeMirror → ProseMirror with proper direction bias.
  // dir: -1 = up/backward, 1 = down/forward
  const maybeEscape = (dir: -1 | 1, exit?: EscapeExitHooks) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const stampMode = (tr: Transaction) => {
      exit?.stamp?.(tr);
      return tr;
    };
    const targetPos = pos + (dir < 0 ? 0 : node().nodeSize);
    const selection = TextSelection.near(
      view.state.doc.resolve(targetPos),
      dir,
    );
    // Check if selection resolved back inside this code block
    const selInside =
      selection.from > pos && selection.from < pos + node().nodeSize;
    if (selInside) {
      // No valid position in escape direction — insert a new paragraph
      const insertPos = dir < 0 ? pos : pos + node().nodeSize;
      const paragraph = view.state.schema.nodes.paragraph.create();
      const tr = view.state.tr.insert(insertPos, paragraph);
      // After insert, positions shift — set selection into the new paragraph
      const newCursorPos = dir < 0 ? insertPos + 1 : insertPos + 1;
      tr.setSelection(TextSelection.near(tr.doc.resolve(newCursorPos), dir));
      view.dispatch(stampMode(tr.scrollIntoView()));
      focusPM();
      return;
    }
    const tr = view.state.tr.setSelection(selection).scrollIntoView();
    view.dispatch(stampMode(tr));
    // Adjacent islands (review): at an A→B code-block boundary the
    // selection resolves INTO B — the injected handoff delivers it (insert
    // intent included); PM focus stays the fallback for a cold island or a
    // widget block with no registrant, and for a hook-less (vim off) exit.
    if (exit?.handoff?.()) return;
    focusPM();
  };

  return { focusPM, maybeEscape };
}
