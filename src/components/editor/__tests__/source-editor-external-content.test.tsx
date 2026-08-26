// §312 마운트된 소스 표면은 **버퍼가 밑에서 바뀐 것**을 화면에 반영해야 한다.
//
// ‼️ 이 테스트가 지키는 것은 기능이 아니라 데이터 손실이다. §305 태스크 쓰기는 소스 모드
// 탭에서 권위 있는 버퍼에 정확히 들어가지만, CodeMirror는 마운트 때 굳힌 doc을 계속
// 보여 준다. 그 상태에서 사용자가 **한 글자만 쳐도** onChange가 CM의 doc 전체를 버퍼에
// 덮어써서 태스크 쓰기가 사라진다. 화면과 버퍼가 갈라져 있는 동안은 그 손실이 예약돼 있다.
//
// 반대 방향의 함정이 같은 크기로 있다: 동기화가 사용자가 방금 만든 편집까지 되감으면
// 그것도 데이터 손실이다. 그래서 단정은 "보인다" 하나가 아니라 **네 가지 보존**이다 —
// 커서, 스크롤, 실행 취소 스택, 그리고 뷰보다 낡은 스냅샷에 대한 무시.

import type { SourceCodeEditorRef } from "../SourceCodeEditor";

import { undo } from "@codemirror/commands";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SourceCodeEditor } from "../SourceCodeEditor";

const ORIGINAL = "- [ ] alpha\n- [ ] beta\n";

/** CodeMirror의 하이라이트 스타일이 마운트 때 prefers-color-scheme을 묻는다. */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener() {},
      matches: false,
      removeEventListener() {},
    }),
    writable: true,
  });
});

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** 두 프레임을 흘려 두 단계 init(포커스 → 아티팩트 청소)을 끝낸다. */
async function flushInit() {
  await act(async () => {
    await nextFrame();
    await nextFrame();
  });
}

/**
 * 표면을 App과 같은 모양으로 배선한다.
 *
 * ‼️ `content`는 렌더 시점의 **스냅샷**이고, `getLatestContent`는 effect 시점의 버퍼를
 * 읽는다. 실제 배선(tab-surface-renderers.tsx)이 정확히 이 두 갈래다 — 스냅샷은 트리거,
 * 접근자는 진실원.
 */
function renderEditor() {
  const buffer = { current: ORIGINAL };
  const onChange = vi.fn((next: string) => {
    buffer.current = next;
  });
  const ref = { current: null as null | SourceCodeEditorRef };

  const view = render(
    <SourceCodeEditor
      content={buffer.current}
      getLatestContent={() => buffer.current}
      onChange={onChange}
      ref={ref}
    />,
  );

  /** 바깥에서 버퍼가 바뀐 뒤 App이 리렌더하는 것과 같은 순서. */
  const pushBuffer = (next: string) => {
    buffer.current = next;
    view.rerender(
      <SourceCodeEditor
        content={next}
        getLatestContent={() => buffer.current}
        onChange={onChange}
        ref={ref}
      />,
    );
  };

  /** 뷰보다 **낡은** 스냅샷이 도착하는 경우 — 버퍼는 건드리지 않는다. */
  const pushStaleSnapshot = (stale: string) => {
    view.rerender(
      <SourceCodeEditor
        content={stale}
        getLatestContent={() => buffer.current}
        onChange={onChange}
        ref={ref}
      />,
    );
  };

  return { buffer, onChange, pushBuffer, pushStaleSnapshot, ref, view };
}

/** 사용자가 친 것과 같은 트랜잭션. */
function type(view: EditorView, at: number, text: string) {
  view.dispatch({
    changes: { from: at, insert: text, to: at },
    selection: { anchor: at + text.length },
    userEvent: "input.type",
  });
}

function viewOf(container: HTMLElement): EditorView {
  const el = container.querySelector<HTMLElement>(".cm-content");
  const found = el ? EditorView.findFromDOM(el) : null;
  if (!found) throw new Error("CodeMirror view not found");
  return found;
}

describe("source surface — external buffer changes", () => {
  it("shows a buffer change that happened under the mounted view", async () => {
    const { pushBuffer, view } = renderEditor();
    await flushInit();
    const cm = viewOf(view.container);

    pushBuffer("- [x] alpha\n- [ ] beta\n");

    expect(cm.state.doc.toString()).toBe("- [x] alpha\n- [ ] beta\n");
  });

  it("keeps the caret on the same character when a line above changes", async () => {
    const { pushBuffer, view } = renderEditor();
    await flushInit();
    const cm = viewOf(view.container);

    // 두 번째 줄 "beta"의 'e' 앞에 커서를 둔다.
    const caret = ORIGINAL.indexOf("beta") + 1;
    cm.dispatch({ selection: { anchor: caret } });
    const charAtCaret = cm.state.sliceDoc(caret, caret + 1);

    // 첫 줄이 길어진다(§306 날짜 배정과 같은 모양).
    pushBuffer("- [x] alpha 📅 2026-08-26\n- [ ] beta\n");

    const head = cm.state.selection.main.head;
    expect(cm.state.sliceDoc(head, head + 1)).toBe(charAtCaret);
    expect(cm.state.doc.lineAt(head).number).toBe(2);
  });

  it("never asks the view to scroll when the buffer changes", async () => {
    const { pushBuffer, view } = renderEditor();
    await flushInit();
    const cm = viewOf(view.container);

    // ‼️ scrollTop을 보는 단정은 여기서 **공허하다** — jsdom에는 레이아웃이 없어
    // CM의 스크롤 측정 자체가 돌지 않고, `scrollIntoView: true`를 넣은 구현도 초록으로
    // 통과한다(뮤테이션으로 확인). 실제로 셀 수 있는 것은 트랜잭션이 스크롤을
    // **요청했는가**다 — 뷰포트가 움직이는 유일한 통로가 그 플래그다.
    const scrollRequests: string[] = [];
    cm.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            if (tr.scrollIntoView) scrollRequests.push(tr.newDoc.toString());
          }
        }),
      ),
    });

    pushBuffer("- [x] alpha\n- [ ] beta\n");

    expect(scrollRequests).toEqual([]);
  });

  it("keeps the undo history — the view is never rebuilt", async () => {
    const { buffer, pushBuffer, view } = renderEditor();
    await flushInit();
    const cm = viewOf(view.container);

    type(cm, ORIGINAL.length, "- [ ] gamma\n");
    const typed = buffer.current;
    expect(typed).not.toBe(ORIGINAL);

    pushBuffer(typed.replace("- [ ] alpha", "- [x] alpha"));

    // ‼️ 동기화 **후에** 다시 집는다. 마운트 effect의 deps에 content가 들어가면 뷰가
    // destroy 후 재생성되는데, 앞에서 잡아둔 참조로 단정하면 죽은 뷰를 보면서 초록이 된다.
    const live = viewOf(view.container);
    expect(live).toBe(cm);

    // 새 EditorState였다면 스택이 비어 첫 undo부터 false다.
    let steps = 0;
    while (steps < 10 && undo(live)) steps++;
    expect(steps).toBeGreaterThan(0);
    expect(live.state.doc.toString()).toBe(ORIGINAL);
  });

  it("does not echo the user's own typing back into the view", async () => {
    const { buffer, onChange, pushBuffer, view } = renderEditor();
    await flushInit();
    const cm = viewOf(view.container);

    const caret = ORIGINAL.indexOf("beta") + 1;
    cm.dispatch({ selection: { anchor: caret } });
    type(cm, caret, "X");
    expect(onChange).toHaveBeenCalledTimes(1);
    const afterTyping = cm.state.selection.main.head;

    // App이 버퍼 변경을 관찰하고 리렌더한다 — 그 값은 CM이 방금 만든 것이다.
    pushBuffer(buffer.current);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(cm.state.selection.main.head).toBe(afterTyping);
  });

  it("ignores a snapshot older than what the view already produced", async () => {
    const { onChange, pushStaleSnapshot, view } = renderEditor();
    await flushInit();
    const cm = viewOf(view.container);

    // 실제 경합의 순서다. ① 태스크 쓰기가 버퍼를 고치고 리렌더가 예약된다(그 렌더가
    // 들고 갈 스냅샷 = TASK). ② 그 렌더의 effect가 돌기 **전에** 사용자가 한 글자를
    // 친다 — CM의 onChange가 버퍼를 통째로 갈아끼우므로 버퍼도, 뷰도 ORIGINAL+"X"가
    // 되고 손에 든 TASK만 낡는다.
    const TASK = "- [x] alpha\n- [ ] beta\n";
    type(cm, ORIGINAL.length, "X");
    const live = cm.state.doc.toString();
    const caret = cm.state.selection.main.head;
    expect(onChange).toHaveBeenCalledTimes(1);

    // ③ 그 렌더가 도착한다. 낡은 스냅샷을 밀어 넣으면 방금 친 글자가 지워지고
    // 캐럿까지 옮겨 간다 — 접근자로 다시 물으면 뷰와 같은 값이 나와 아무 일도 없다.
    pushStaleSnapshot(TASK);

    expect(cm.state.doc.toString()).toBe(live);
    expect(cm.state.selection.main.head).toBe(caret);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a buffer change that landed during the two-phase init", async () => {
    const { pushBuffer, view } = renderEditor();

    // 소스 모드로 들어간 **직후** 태스크 쓰기가 버퍼를 고친다 — init의 두 프레임이
    // 아직 돌지 않았다. 아티팩트 청소가 마운트 스냅샷으로 되돌리면 그 쓰기가 사라진다.
    pushBuffer("- [x] alpha\n- [ ] beta\n");
    await flushInit();

    expect(viewOf(view.container).state.doc.toString()).toBe(
      "- [x] alpha\n- [ ] beta\n",
    );
  });

  it("does not count an external sync as a user edit", async () => {
    const { pushBuffer, ref, view } = renderEditor();
    await flushInit();
    viewOf(view.container);

    pushBuffer("- [x] alpha\n- [ ] beta\n");

    // hasUserEdited는 토글-백에서 "CM의 doc을 믿어도 되는가"를 판정한다(§5.1
    // WebKit 아티팩트 방어). 우리가 밀어 넣은 변경은 사용자의 편집이 아니다.
    expect(ref.current?.hasUserEdited()).toBe(false);
  });
});
