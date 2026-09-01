// M2-b4 편집 모달 ↔ 문서 — 블록 하나를 마크다운으로 읽고, 고친 줄로 되돌려 놓는다.
//
// `textBetween`을 쓰지 않는다. 위키링크·멘션·인라인 수식은 **인라인 atom 노드**라
// 글자가 아니어서, 그 경로로 읽으면 `[[202607051530]]`이 공백 하나가 되어 사라진다.
// 대신 이 앱이 파일을 읽고 쓸 때 쓰는 바로 그 파이프라인을 탄다 — 라운드트립이 이미
// 그 경로에 걸려 있으므로, 여기서 새 보장을 만들 필요가 없다.

import type { TaskEditTarget } from "./task-edit-target";
import type { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import { TASK_STATE_MARKER } from "../../ipc/types";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import {
  canonicalNodeAt,
  serializeDetachedDoc,
} from "../editor/serialize-live-doc";

/**
 * 대상 블록의 본문을 마크다운 한 줄로 읽는다 — 태스크면 `- [ ] ` 접두를 뗀 나머지.
 *
 * 접두를 떼는 이유는 폼이 상태를 다루지 않기 때문이다. 체크 전이는 `setTaskState`가
 * 이미 갖고 있고(완료일 `✅` 규칙이 거기 붙어 있다), 두 곳이 마커를 쓰면 그 규칙이
 * 갈라진다.
 */
export function readTargetLine(
  state: EditorState,
  target: TaskEditTarget,
): string {
  const { schema } = state;
  // §384: serialize the CANONICAL node — if the caret opened this modal while
  // resting inside a mark/link/wikilink expansion within the target block, the
  // live `target.node` still holds literal delimiter text. This swap is LOCAL
  // to this read; `applyTargetLine` below still replaces using the LIVE
  // `target.node`'s range — and validates at apply time that this range still
  // exists, since the document can change while the modal is open (이슈 498).
  const canonicalNode =
    canonicalNodeAt(state, target.pos, target.node.type.name) ?? target.node;
  const wrapped = target.isTask
    ? schema.nodes.taskList.create(null, [canonicalNode])
    : canonicalNode;
  const doc = schema.topNodeType.create(null, [wrapped]);
  const md = serializeDetachedDoc(doc).trim();
  return target.isTask ? md.replace(TASK_PREFIX_RE, "") : md;
}

/**
 * 고친 줄을 문서에 되돌려 놓는다. 대상이 태스크가 아니었으면 **태스크가 된다.**
 *
 * 성공하면 `true`. 파싱 결과가 기대한 모양이 아니면 아무것도 하지 않고 `false` —
 * 문서를 반쯤 바꿔 놓느니 아무 일도 일어나지 않는 편이 낫다.
 */
export function applyTargetLine(
  editor: Editor,
  target: TaskEditTarget,
  line: string,
): boolean {
  const { doc, schema } = editor.state;

  // 이슈 498: target은 모달이 **열릴 때** 캡처된 좌표다. 모달이 떠 있는 동안에도
  // 전역 키보드 dispatch·외부 리로드·§384 reveal collapse가 문서를 바꿀 수 있어,
  // 캡처된 `pos ~ pos + node.nodeSize`가 지금도 유효하다는 보장이 없다 — stale
  // 범위로 splice하면 다음 블록 머리를 잘라먹거나(silent data loss) 문서 끝에서
  // RangeError를 던진다. ProseMirror 노드는 불변·구조 공유라 `===`가 정확한
  // 판정이다: target 뒤쪽만 바뀐 문서는 같은 객체를 그대로 들고 있어 통과하고,
  // target을 건드렸거나 좌표가 밀렸거나 재파싱됐으면 실패한다. (한계: `===`는
  // 같은 노드 **객체**가 문서에 두 번 꽂히는 경우 occurrence를 구별하지 못한다 —
  // 현재 이 모달에 닿는 경로는 전부 toJSON 직렬화를 거쳐 새 객체를 만들므로
  // 도달 불가지만, 노드 객체를 직접 재사용하는 미래 코드는 이 가드를 재검토할 것.)
  // 음수 pos와 content.size 초과는 nodeAt이 RangeError를 던지므로 먼저 거른다.
  if (
    target.pos < 0 ||
    target.pos > doc.content.size ||
    doc.nodeAt(target.pos) !== target.node
  ) {
    return false;
  }
  const marker = `- [${TASK_STATE_MARKER[target.state]}] `;
  const parsed = markdownToProsemirror(`${marker}${line}`, schema);

  // 파서는 `taskList > taskItem`을 돌려준다. 태스크 항목을 바꾸는 경우에는 항목만
  // 꺼내 끼우고(리스트를 통째로 넣으면 리스트 안에 리스트가 생긴다), 문단을 바꾸는
  // 경우에는 리스트째로 넣는다.
  const list = parsed.firstChild;
  if (!list || list.type.name !== "taskList") return false;
  const replacement = target.isTask ? list.firstChild : list;
  if (!replacement) return false;

  // focus를 chain에 넣지 않는다 — chain().run()은 모든 command 반환값의 합산이라,
  // focus만 실패해도 문서는 이미 바뀌었는데 false가 돌아온다. "false면 no-op"이라는
  // 이 함수의 계약(위 stale 가드가 기대는 그 계약)이 깨지므로, 교체 성공 후에
  // 별도로 포커스한다.
  const applied = editor
    .chain()
    .command(({ tr }) => {
      tr.replaceWith(
        target.pos,
        target.pos + target.node.nodeSize,
        replacement,
      );
      return true;
    })
    .run();
  if (applied) editor.commands.focus();
  return applied;
}

/**
 * `- [ ] ` / `- [x] ` / `- [/] ` / `* [-] ` … 어느 표기로 직렬화되든 뗀다.
 *
 * ‼️ 네 상태를 모두 알아야 한다. `[ xX]`만 알던 시절 `- [/] 진행 중`은 접두가 떨어지지
 * 않아 모달 입력칸에 `[/] `가 글자로 남았고, 저장하면 `- [/] [/] 진행 중`이 됐다.
 * (클래스 안 맨 뒤의 `-`는 리터럴 하이픈이다 — 범위가 아니다.)
 */
const TASK_PREFIX_RE = /^[-*+]\s+\[[ xX/-]\]\s*/;
