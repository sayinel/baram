// §313 열린 문서를 이미 디스크에 있는 내용으로 맞춘다 — **트랜잭션 하나로**.
//
// 지금까지 이 일은 `EditorState.create`로 상태를 통째로 갈아끼워서 했다. 그 방법은
// 문서를 확실히 맞추지만 함께 버리는 것이 있다: 사용자가 쌓아 둔 실행 취소 스택, 커서,
// 그리고 모든 노드 뷰(코드블록·수식·머메이드는 재생성되고 스크롤이 튄다). 사이드바에서
// 체크박스 하나를 누른 대가로는 너무 크다.
//
// 그래서 바뀐 최상위 블록 구간만 찾아 그 자리만 갈아끼운다. 앞뒤로 같은 블록은
// **같은 노드 객체 그대로** 남으므로 ProseMirror의 뷰 diff가 그 자리의 DOM을 건드리지
// 않는다.
//
// `addToHistory: false`인 이유: 이것은 사용자의 편집이 아니라 이미 일어난 일을 화면에
// 반영하는 것이다. 히스토리에 넣으면 되돌리기가 디스크에 이미 쓰인 변경을 화면에서만
// 되돌려 놓고, 다음 저장이 그 되돌린 내용을 파일에 써서 디스크와 화면이 갈라진다.
// 넣지 않으면 기존 항목들이 이 스텝을 통과해 재배치될 뿐 그대로 살아남는다.

import type { Node } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { markdownToProsemirror } from "../../pipeline";
import { CONTENT_SYNC_META } from "./programmatic-update";

interface TopLevelDiff {
  fromIndex: number;
  fromPos: number;
  toIndexNew: number;
  toPosOld: number;
}

/**
 * `markdown`이 이미 문서와 같으면 **아무것도 보내지 않고** `false`.
 *
 * 이 `false`가 중요하다: 앱 자신의 쓰기는 동기 경로와 워처 경로 양쪽에서 도착할 수
 * 있는데(§313), 두 번째 도착이 빈 트랜잭션이라도 보내면 그때마다 커서가 흔들리고
 * 자동 저장의 dirty 판정이 깨어난다.
 */
export function patchEditorContent(
  view: EditorView,
  markdown: string,
): boolean {
  const next = markdownToProsemirror(markdown, view.state.schema);
  const range = topLevelDiff(view.state.doc, next);
  if (!range) return false;

  const replacement: Node[] = [];
  for (let i = range.fromIndex; i < range.toIndexNew; i++) {
    replacement.push(next.child(i));
  }

  const tr = view.state.tr;
  tr.replaceWith(range.fromPos, range.toPosOld, replacement);
  // 선택은 손대지 않는다 — Transaction이 스텝을 통과시켜 알아서 옮긴다. 여기서
  // 다시 세우면 바뀐 구간 **밖에** 있던 커서까지 근처로 끌어당긴다.
  tr.setMeta("addToHistory", false);
  tr.setMeta(CONTENT_SYNC_META, true);
  view.dispatch(tr);
  return true;
}

/** 최상위 자식 `index` 바로 앞의 위치. doc의 내용은 0에서 시작한다. */
function posBeforeChild(doc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * 두 문서가 갈라지는 최상위 블록 구간. 완전히 같으면 `null`.
 *
 * 최상위 블록 단위인 이유: 그보다 잘게 자르려면 리스트 안쪽까지 내려가야 하는데,
 * 그 경계는 마크다운 줄 번호와 1:1이 아니라(한 리스트가 한 블록이다) 잘못 자르면
 * 이웃 항목을 지운다. 블록 단위는 항상 안전하고, 실제 문서에서 바뀌는 블록은 보통
 * 하나다.
 */
function topLevelDiff(a: Node, b: Node): null | TopLevelDiff {
  let start = 0;
  const shared = Math.min(a.childCount, b.childCount);
  while (start < shared && a.child(start).eq(b.child(start))) start++;

  let endA = a.childCount;
  let endB = b.childCount;
  while (
    endA > start &&
    endB > start &&
    a.child(endA - 1).eq(b.child(endB - 1))
  ) {
    endA--;
    endB--;
  }

  if (start === endA && start === endB) return null;

  return {
    fromIndex: start,
    fromPos: posBeforeChild(a, start),
    toIndexNew: endB,
    toPosOld: posBeforeChild(a, endA),
  };
}
