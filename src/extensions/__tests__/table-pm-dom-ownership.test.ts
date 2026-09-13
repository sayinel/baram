import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { createBaramExtensions } from "../index";

function tableMarkdown(dataRows: number): string {
  const rows = Array.from({ length: dataRows }, (_, i) => `| r${i} | v${i} |`);
  return ["| a | b |", "| --- | --- |", ...rows].join("\n") + "\n";
}

// §5.5 Table — ProseMirror가 소유한 표 DOM에 플러그인이 속성을 쓰면 안 된다.
//
// 왜 이 테스트가 있는가: `table-virtual-scroll` 플러그인이 50행 이상 표의 모든
// <tr>에 `class`와 인라인 `style`을 view update마다 imperative하게 썼다. PM의
// DOMObserver(MutationObserver)가 그 속성 변경을 보고 markDirty → 재렌더로 방금
// 쓴 값을 지우고, 재렌더가 플러그인 update()를 다시 불러 또 쓴다. 이 순환은 하나의
// microtask checkpoint 안에서 돌아 이벤트 루프로 돌아가지 않는다 — 표가 50행인
// 문서를 **여는 것만으로** WKWebView가 영구 정지했다 (2026-09-13 실측: WebContent
// 100% CPU 무한, RSS 614MB→984MB 계속 증가, Cmd+Q도 불가).
//
// jsdom은 그 루프 자체를 재현하지 못한다 (레이아웃이 없어 8ms에 정착한다). 그래서
// 루프가 아니라 **루프의 원인**을 단정한다: PM이 그린 <tr>은 PM 것이므로, 마운트가
// 끝난 뒤 외부가 남긴 속성이 하나도 없어야 한다. 결함이 있던 시점에 이 단정은
// 49행에서는 통과하고 50행·200행에서 실패했다 (<tr> 전부가 class+style을 가졌다).
describe("Table: PM이 소유한 <tr>에 외부 속성이 남지 않는다", () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = undefined;
    host = undefined;
  });

  function mountTable(dataRows: number): HTMLTableRowElement[] {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: createBaramExtensions() });
    const doc = markdownToProsemirror(tableMarkdown(dataRows), editor.schema);
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        doc.content,
      ),
    );
    return [...editor.view.dom.querySelectorAll("tr")];
  }

  // 48 = 옛 임계값(50 <tr>) 바로 아래, 49 = 정확히 그 경계, 199 = 훨씬 위.
  // 경계만 보면 "임계값을 올리는" 회귀가 그대로 통과하므로 위아래를 함께 고정한다.
  it.each([48, 49, 199])(
    "데이터 %i행 표를 마운트해도 <tr>에 class/style이 붙지 않는다",
    (dataRows) => {
      const trs = mountTable(dataRows);
      expect(trs).toHaveLength(dataRows + 1);

      const touched = trs
        .map((tr, i) => ({
          i,
          class: tr.getAttribute("class"),
          style: tr.getAttribute("style"),
        }))
        .filter((r) => r.class !== null || r.style !== null);

      expect(touched).toEqual([]);
    },
  );
});
