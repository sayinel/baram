// §312 ➕ 자동 스탬프 — 에디터에서 **새로 쓴** 태스크 줄에 등록일을 붙인다.
//
// 왜 필요한가: 방치 배지(30일+)와 주간 리뷰의 정렬은 `➕` 하나에만 기댄다. Rust
// `TaskEntry`에 파일 mtime이 없기 때문이다(§18.7). 캡처 경로(`task-capture.ts`)는
// 이미 붙이고 있었으므로, 문서에 직접 친 줄만 배지를 받지 못하는 상태였다 —
// 같은 태스크가 "어디서 만들었는가"에 따라 다르게 보였다(사용자 보고).
//
// ‼️ 언제 붙이는가가 이 파일의 전부다. 세 가지를 동시에 만족해야 한다.
//
// 1. **만들 때가 아니라 떠날 때.** 만드는 순간 넣으면 사용자는 `➕2026-08-30`이
//    적힌 줄에 본문을 타이핑하게 되고(칩 플러그인은 커서가 있는 줄을 원문 그대로
//    둔다), Enter를 치면 커서 뒤의 그 스탬프가 **다음 항목으로 잘려 나간다**.
//    게다가 빈 항목이 사라지므로 Enter 두 번으로 목록을 빠져나올 수도 없게 된다.
// 2. **새 줄만.** 지난달에 쓴 태스크를 고치다 떠났다고 오늘 날짜를 찍으면 그건
//    거짓말이다. 그래서 후보는 "커서가 **빈** 태스크 줄에 들어왔을 때"만 생긴다 —
//    입력 규칙이 만든 줄도, Enter가 나눈 줄도 그 순간 비어 있고, 기존 줄은 아니다.
// 3. **본문이 있을 때만.** `- [ ] `만 치고 나간 줄에 날짜만 남으면, 지울 수도 없는
//    빈 태스크가 배지를 달고 아젠다에 뜬다.
//
// 창구가 하나뿐인 것도 의도다: Enter·클릭·화살표·다른 파일로 이동이 전부 "커서가
// 그 줄을 떠났다"는 한 가지 사실로 모인다. 생성 지점마다 훅을 달면 그중 하나는
// 반드시 빠진다.

import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { useSettingsStore } from "../../stores/settings/store";
import { resolveDateInput } from "../../utils/tasks/task-date-input";
import { scanTaskFields } from "../../utils/tasks/task-field-scan";
import { readTaskLine } from "../../utils/tasks/task-line-edit";

interface StampState {
  /** 지금 쓰고 있는 새 태스크 줄의 위치. 없으면 null */
  fresh: null | number;
  /** 이번 트랜잭션에서 커서가 **떠난** 새 태스크 줄 — `appendTransaction`의 대상 */
  left: null | number;
}

interface TaskItemAt {
  node: PMNode;
  pos: number;
}

const EMPTY: StampState = { fresh: null, left: null };

const stampKey = new PluginKey<StampState>("taskCreatedStamp");

export const TaskCreatedStamp = Extension.create({
  name: "taskCreatedStamp",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<StampState>({
        key: stampKey,

        appendTransaction: (_trs, _oldState, newState) => {
          const { left } = stampKey.getState(newState) ?? EMPTY;
          if (left === null) return null;
          // ‼️ 읽기 전용 뷰에서는 커서만 움직여도 여기까지 온다. 사용자가 고칠 수
          // 없는 문서를 우리가 고치면 그건 어떤 설정으로도 설명되지 않는다.
          if (!editor.isEditable) return null;
          if (!stampEnabled()) return null;

          const node = newState.doc.nodeAt(left);
          // 매핑이 살아남았어도 그 자리가 여전히 태스크 줄이라는 보장은 없다
          // (Enter 두 번으로 목록을 빠져나오면 그 줄은 문단이 된다).
          if (node?.type.name !== "taskItem") return null;
          const para = node.firstChild;
          if (!para || para.type.name !== "paragraph") return null;

          const text = para.textContent;
          // 어휘는 ⌘⌥T 편집 모달과 **같은 리더**로 읽는다. 여기서 따로 판정하면
          // 모달이 "등록일 있음"으로 보는 줄에 스탬프가 하나 더 붙을 수 있다.
          const draft = readTaskLine(text);
          if (!draft.body.trim()) return null;
          if (draft.dates.created) return null;

          const today = resolveDateInput("t", new Date());
          if (!today) return null;

          const { at, insert } = stampInsertion(para, left + 2, `➕${today}`);
          return newState.tr.insertText(insert, at);
        },

        state: {
          apply: (tr, value, _oldState, newState) => {
            const fresh = mapFresh(value.fresh, tr);
            const cursor = taskItemAt(newState.selection.$from);

            // 같은 줄에 그대로 있다 — 아직 쓰는 중이다.
            if (fresh !== null && cursor?.pos === fresh) {
              return { fresh, left: null };
            }
            // 빈 태스크 줄에 커서가 있다 = 방금 생긴 줄. 입력 규칙이 만들었든
            // Enter가 나눴든 그 순간의 모습은 같으므로 생성 지점을 몰라도 된다.
            const next =
              cursor && cursor.node.textContent.trim() === ""
                ? cursor.pos
                : null;
            return { fresh: next, left: fresh };
          },
          init: () => EMPTY,
        },
      }),
    ];
  },
});

/** 후보 위치를 이번 트랜잭션 뒤 좌표로 옮긴다. 그 줄이 지워졌으면 후보도 없다. */
function mapFresh(pos: null | number, tr: Transaction): null | number {
  if (pos === null) return null;
  const mapped = tr.mapping.mapResult(pos);
  return mapped.deleted ? null : mapped.pos;
}

/**
 * 스탬프를 넣을 위치와 문자열.
 *
 * §303 순서에서 `➕`는 맨 앞이므로 **첫 이모지 필드 앞**에 넣는다. 필드는 줄 끝에
 * 모이므로 마지막 텍스트 노드만 보면 되고, 그 안에서는 스캐너의 UTF-16 오프셋을
 * 위치에 그대로 더할 수 있다(`task-field-scan.ts`). 필드가 없으면 줄 끝이다.
 *
 * 마지막 자식이 텍스트가 아니면(위키링크·수식 같은 인라인 원자로 끝나는 줄) 줄 끝에
 * 붙인다 — 원자는 글자 수와 위치 수가 어긋나므로 오프셋을 더하면 틀린 자리에 넣는다.
 */
function stampInsertion(
  para: PMNode,
  paraStart: number,
  stamp: string,
): { at: number; insert: string } {
  const end = paraStart + para.content.size;
  const last = para.lastChild;
  if (last?.isText && last.text) {
    const spans = scanTaskFields(last.text);
    if (spans.length > 0) {
      const at = end - last.nodeSize + spans[0].from;
      // 필드 앞에는 이미 공백이 있다(그 필드가 그렇게 쓰였다) — 뒤에만 하나 둔다.
      return { at, insert: `${stamp} ` };
    }
  }
  return { at: end, insert: ` ${stamp}` };
}

/**
 * 설정을 읽는다 — React 밖이라 `getState()`를 쓴다(`drop-handler.ts`의 관례).
 *
 * `tasksEnabled`까지 보는 이유: 태스크 기능을 통째로 끈 사용자에게 문서만 조용히
 * 바뀌면 그것은 설정이 거짓말을 한 것이다.
 */
function stampEnabled(): boolean {
  const s = useSettingsStore.getState();
  return s.tasksEnabled && s.tasksStampCreatedDate;
}

/** `$pos`를 품은 가장 안쪽 taskItem. 없으면 null. */
function taskItemAt($pos: ResolvedPos): null | TaskItemAt {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "taskItem") return { node, pos: $pos.before(d) };
  }
  return null;
}
