// §313 `scrollToTarget`은 **dispatch할 때의** 문서에서 좌표를 잡는다.
//
// 호출자는 전부 문서가 아직 자리를 잡는 중인 시점에 부른다 — 탭 전환의 캐시 복원 분기는
// 캐시된 EditorState를 `setTimeout`에 예약해 두고 그 자리에서 이 함수를 부르므로, 부르는
// 순간 뷰는 아직 **나가는** 문서를 들고 있다. 좌표를 그때 잡아 버리면 들어오는 파일의 줄
// 번호를 남의 문서에 맞춰 재게 되고, 커서는 문서 첫머리에 앉는다.
import type { Editor } from "@tiptap/core";

import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  // ‼️ 이 단정이 결함 그 자체다. 예전 구현은 목적지 노드에
  // `scrollIntoView({ block: "center" })`를 걸었고, 그 API는 어느 조상을 뜻했는지 말할 수
  // 없어 **스크롤 가능한 조상을 전부** 가운데 맞춤 한다. 창이 작아 앱 셸이 스크롤 가능해지면
  // 탭 바들이 화면 밖으로 밀려 잘렸다. jsdom에는 레이아웃이 없어 픽셀은 못 재지만, "이
  // API를 아예 부르지 않는다"는 스파이로 정확히 관측된다.
  it("어떤 요소에도 scrollIntoView를 걸지 않는다 — 조상까지 끌고 가는 API다", async () => {
    // 실제 모양대로 세운다: 스크롤 가능한 바깥(작은 창의 앱 셸) 안에 에디터의 스크롤
    // 컨테이너가 있고, 그 안에 뷰가 있다.
    const outer = document.createElement("div");
    const container = document.createElement("div");
    container.setAttribute("data-editor-scroll", "");
    outer.appendChild(container);
    document.body.appendChild(outer);
    container.appendChild(editor.view.dom.parentElement ?? editor.view.dom);

    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      install(INCOMING);
      scrollToTarget(editor.view, INCOMING, { kind: "line", value: 5 });
      await nextFrame();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      document.body.innerHTML = "";
    }
  });
});
