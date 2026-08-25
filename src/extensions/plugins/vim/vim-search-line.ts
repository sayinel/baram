// §298 vim `/` 검색 — StatusBar input과 core를 잇는 배선 (IME 정공법).
//
// 모달 surface는 non-editable이라 조합(composition)이 일어나지 않는다:
// keydown 누적만으로는 `한`이 자모 낱개(ㅎㅏㄴ)로 쌓여 NFC 문서와 매치되지
// 않았다(적대 리뷰, 재현). 그래서 `/`가 열리면 StatusBar가 진짜 <input>을
// 렌더하고, 이 모듈이 그 input의 변경·확정·취소를 core 상태로 배선한다.
// core가 단일 진실이다 — input의 value는 core.searchLine.text의 미러이고,
// 탭 전환 리셋(vim-activation)·StatusBar 표시가 전부 core에서 나온다.
//
// state-machine의 keydown 누적 경로는 그대로 둔다: input이 포커스를 쥐면
// 에디터에 키가 닿지 않아 이중 처리가 없고, StatusBar가 없는 환경(테스트
// 하네스)에서는 그 경로가 동작을 보존한다.

import type { SearchDirection } from "./core/types";
import type { VimPluginState } from "./vim-plugin";
import type { Editor } from "@tiptap/core";

import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import { focusEditorView } from "../../../utils/editor/focus-editor-view";
import { enterCodeBlockSelection } from "../../nodes/views/code-block-cm-registry";
import { scrollCursorIntoView } from "./adapters/scroll";
import { resolveSearch } from "./adapters/search";
import { vimPluginKey } from "./vim-keys";

/** Escape / blur: close the line. Only Escape hands focus back — a blur
 *  means the user already put focus somewhere else on purpose. */
export function closeSearchLine(editor: Editor, refocus: boolean): void {
  const line = readLine(editor);
  if (line === null) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      core: { ...core(editor), searchLine: null },
      type: "core",
    }),
  );
  if (refocus) focusEditorView(editor.view);
}

/**
 * Enter: the input-side twin of the state machine's Enter — jump, record
 * lastSearch, close the line, all in ONE transaction, then hand focus back.
 * An empty line repeats the last pattern in the line's direction; a miss is
 * the usual silence (the meta still lands: the line DID close).
 */
export function submitSearchLine(editor: Editor): void {
  const line = readLine(editor);
  if (line === null) return;
  const previous = core(editor);
  const pattern =
    line.text !== "" ? line.text : (previous.lastSearch?.pattern ?? null);
  if (pattern === null) {
    closeSearchLine(editor, true);
    return;
  }

  const view = editor.view;
  const from =
    view.state.selection instanceof NodeSelection
      ? view.state.selection.from
      : view.state.selection.head;
  const target = resolveSearch(view.state, from, pattern, line.direction, 1);

  const tr = view.state.tr;
  if (target !== null) {
    // Matches only exist inside textblocks — a text caret is always right.
    tr.setSelection(TextSelection.create(tr.doc, target));
  }
  tr.setMeta(vimPluginKey, {
    core: {
      ...previous,
      lastSearch: { direction: line.direction, pattern },
      searchLine: null,
    },
    type: "core",
  });
  view.dispatch(tr);
  // The landing needs the same churn suppression as every vim cursor write —
  // WebKit's late re-normalisation would revert it otherwise (PR 307).
  (
    view as unknown as {
      domObserver?: { suppressSelectionUpdates?: () => void };
    }
  ).domObserver?.suppressSelectionUpdates?.();
  if (target !== null) scrollCursorIntoView(view, target);
  // A match inside a code block needs the explicit island handoff — this
  // dispatch bypasses dispatchCursor, and PM's gated selectionToDOM will not
  // call NodeView.setSelection on the modal view. When the island answers,
  // IT owns focus; falling through to focusEditorView would immediately
  // steal the focus back from CM.
  if (target !== null && enterCodeBlockSelection(view)) return;
  focusEditorView(view);
}

/** Mirror the input's (IME-composed) value into the core line. */
export function updateSearchLineText(editor: Editor, text: string): void {
  const line = readLine(editor);
  if (line === null || line.text === text) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      core: { ...core(editor), searchLine: { ...line, text } },
      type: "core",
    }),
  );
}

function core(editor: Editor): VimPluginState["core"] {
  return (vimPluginKey.getState(editor.state) as unknown as VimPluginState)
    .core;
}

/** Current core searchLine, or null when the line is closed. */
function readLine(
  editor: Editor,
): null | { direction: SearchDirection; text: string } {
  const vim = vimPluginKey.getState(editor.state) as unknown as
    undefined | VimPluginState;
  if (!vim?.enabled) return null;
  return vim.core.searchLine;
}
