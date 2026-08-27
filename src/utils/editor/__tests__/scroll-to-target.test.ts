// §313 `scrollToTarget`은 **dispatch할 때의** 문서에서 좌표를 잡는다.
//
// 호출자는 전부 문서가 아직 자리를 잡는 중인 시점에 부른다 — 탭 전환의 캐시 복원 분기는
// 캐시된 EditorState를 `setTimeout`에 예약해 두고 그 자리에서 이 함수를 부르므로, 부르는
// 순간 뷰는 아직 **나가는** 문서를 들고 있다. 좌표를 그때 잡아 버리면 들어오는 파일의 줄
// 번호를 남의 문서에 맞춰 재게 되고, 커서는 문서 첫머리에 앉는다.
import type { Editor } from "@tiptap/core";

import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestEditor } from "../../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { scrollToTarget } from "../pending-scroll";

const INCOMING = [
  "# Title",
  "",
  "- [ ] first task",
  "- [ ] second task",
  "- [ ] third task",
  "",
  "After the list.",
  "",
].join("\n");

let editor: Editor;

function install(md: string) {
  editor.view.updateState(
    EditorState.create({
      doc: markdownToProsemirror(md, editor.schema),
      plugins: editor.state.plugins,
    }),
  );
}

/** 다음 프레임 하나를 흘려보낸다 — `scrollToTarget`이 예약한 콜백이 그 안에서 돈다. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

beforeEach(() => {
  editor = makeTestEditor("<p>outgoing document</p>");
});

afterEach(() => {
  editor.destroy();
});

describe("scrollToTarget", () => {
  it("부른 뒤에 문서가 들어와도 그 줄에 내린다", async () => {
    // 부르는 순간 뷰가 든 것은 나가는 문서다.
    scrollToTarget(editor.view, INCOMING, { kind: "line", value: 5 });
    install(INCOMING);

    await nextFrame();

    expect(editor.state.selection.$from.parent.textContent).toBe("third task");
  });

  it("이미 들어와 있는 문서에서도 같은 자리에 내린다", async () => {
    install(INCOMING);

    scrollToTarget(editor.view, INCOMING, { kind: "line", value: 4 });
    await nextFrame();

    expect(editor.state.selection.$from.parent.textContent).toBe("second task");
  });

  it("파괴된 뷰에는 아무것도 하지 않는다", async () => {
    scrollToTarget(editor.view, INCOMING, { kind: "line", value: 5 });
    editor.destroy();

    await expect(nextFrame()).resolves.toBeUndefined();
  });
});
