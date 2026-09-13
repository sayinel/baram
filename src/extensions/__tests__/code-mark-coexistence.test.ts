import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { createBaramExtensions } from "../index";

// §7.2 인라인 코드 마크는 다른 마크와 공존한다.
//
// 왜 이 테스트가 있는가: `code` mark에 `excludes: "_"`가 달려 있던 동안, 같은
// 문서가 **경로마다 다른 답**을 냈다. 파이프라인은 mark 배열을 직접 만들어
// (`addMark` 미경유) `**`x`**`를 bold+code로 읽어 들이는데, `Mark.addToSet`을
// 지나는 경로는 excludes를 적용해 bold를 떨어뜨렸다.
//
// 측정된 범위를 정확히 적어 둔다 — 나중에 이 주석이 근거로 쓰이기 때문이다:
//   · 디스크 로드는 excludes 유무와 **무관하게** 통과한다. 아래 첫 케이스는
//     대조군이며 이 결함으로는 절대 실패하지 않는다. 실효 가드는 나머지 셋이고,
//     셋 다 결국 같은 `Mark.addToSet` 호출로 수렴한다.
//   · `<strong><code>` HTML을 붙여넣으면 bold가 사라졌다 — 확인됨.
//   · 에디터 DOM을 **통째로** 다시 파싱하면 bold가 사라졌다 — 확인됨.
//     다만 실제 `readDOMChange`는 바뀐 범위만 읽으며, 그쪽에서 이 손실이 나는
//     DOM 변형은 일부다. 한글 IME 조합은 `compositionend`·`view.composing`을
//     거치는데 jsdom이 이를 재현하지 못하므로, **IME에서 실제로 손실이 난다는
//     주장은 이 하네스로 검증되지 않았다.** 여기서 고정하는 것은 스키마 불변식
//     자체이지 특정 입력기의 증상이 아니다.
//
// 마크다운 표준도 이쪽이다 — GFM에서 `**`x`**`는 유효하며 강조된 코드로 렌더된다.
// 배타성은 의도된 제약이 아니라 스키마의 실수였고, 설계 문서 §7.2도 함께 고쳤다.
describe("§7.2 인라인 코드 마크는 다른 마크와 공존한다", () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: createBaramExtensions() });
  });

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = undefined;
    host = undefined;
  });

  const SOURCE = "**`bold code`**\n";

  function marksAt(doc: PMNode, pos: number): string[] {
    return doc
      .resolve(pos)
      .marks()
      .map((m) => m.type.name)
      .sort();
  }

  function allMarksIn(doc: PMNode): string[] {
    const names = new Set<string>();
    doc.descendants((n) => {
      n.marks.forEach((m) => names.add(m.type.name));
    });
    return [...names].sort();
  }

  /** 디스크에서 읽은 문서 — 파이프라인이 mark 배열을 직접 만드는 경로 (대조군) */
  function loadFromDisk(): PMNode {
    return markdownToProsemirror(SOURCE, editor!.schema);
  }

  /**
   * 에디터가 화면에 그린 DOM 전체를 PM이 다시 파싱하는 경로. `readDOMChange`가
   * 쓰는 것과 같은 `DOMParser`를 통과시킨다(범위는 다르다 — 헤더 주석 참조).
   *
   * `DOMSerializer.fromSchema(...)` 출력이 아니라 `view.dom`을 읽는다. 직렬화기
   * 출력은 NodeView·Decoration을 거치지 않은 이상적 마크업이라, 그걸 쓰면 실제로
   * 사용자가 편집하는 DOM이 망가져도 통과하는 대역이 된다.
   */
  function reparseOwnDom(): PMNode {
    const doc = loadFromDisk();
    editor!.view.dispatch(
      editor!.state.tr.replaceWith(
        0,
        editor!.state.doc.content.size,
        doc.content,
      ),
    );
    return PMDOMParser.fromSchema(editor!.schema).parse(editor!.view.dom);
  }

  /**
   * 서식 있는 HTML을 문서에 넣는 경로. `setContent`는 클립보드 파이프라인
   * (`parseFromClipboard`·`handlePaste`·Code mark의 `addPasteRules`)까지 타지는
   * 않지만, 이 결함이 사는 `DOMParser` → `addToSet` 관문은 동일하게 지난다.
   */
  function setContentFromHtml(): PMNode {
    editor!.commands.setContent(
      "<p><strong><code>bold code</code></strong></p>",
    );
    return editor!.state.doc;
  }

  /** 툴바·단축키로 직접 거는 경로 (`addMark` → `addToSet`) */
  function toggleInteractively(): PMNode {
    editor!.commands.setContent("<p>bold code</p>");
    editor!.commands.selectAll();
    editor!.commands.setCode();
    editor!.commands.setBold();
    return editor!.state.doc;
  }

  it.each([
    ["디스크에서 로드 (대조군 — 이 결함으로는 실패하지 않는다)", loadFromDisk],
    ["에디터 DOM 전체 재파싱", reparseOwnDom],
    ["서식 있는 HTML을 setContent로 주입", setContentFromHtml],
    ["툴바·단축키로 직접 토글", toggleInteractively],
  ])("%s — bold와 code가 함께 남는다", (_label, build) => {
    const doc = build();
    expect(marksAt(doc, 2)).toEqual(["bold", "code"]);
    expect(prosemirrorToMarkdown(doc)).toBe(SOURCE);
  });

  // `excludes`를 지우면 `code`와 짝지을 수 있는 조합이 늘어난다. **툴바에서 실제로
  // 거는 경로**로 전수 확인한다 — 라운드트립만 보면 이 결함을 못 잡는다.
  //
  // 라운드트립 단정만 있던 초안이 실제로 세 조합(highlight·sub·sup)을 놓쳤다.
  // 그 셋은 저장은 되지만 **다시 열면 마크가 사라지고 두 번째 저장이 다른 바이트를
  // 쓰는** 손상 경로였다(리뷰 발견). 그래서 여기서는 저장 → 재로드 → 재저장까지
  // 돌려 **마크가 살아 돌아오는지**와 **바이트가 고정되는지**를 함께 본다.
  it.each([
    ["bold", (e: Editor) => e.commands.setBold()],
    ["italic", (e: Editor) => e.commands.setItalic()],
    ["strike", (e: Editor) => e.commands.setStrike()],
    ["underline", (e: Editor) => e.commands.setUnderline()],
    ["highlight", (e: Editor) => e.commands.setHighlight()],
    ["subscript", (e: Editor) => e.commands.setSubscript()],
    ["superscript", (e: Editor) => e.commands.setSuperscript()],
    [
      "link",
      (e: Editor) => e.commands.setLink({ href: "https://example.com" }),
    ],
  ])(
    "툴바에서 인라인 코드에 %s를 걸어도 저장·재로드가 무손실이다",
    (name, apply) => {
      editor!.commands.setContent("<p><code>XY</code></p>");
      editor!.commands.selectAll();
      apply(editor!);

      const applied = allMarksIn(editor!.state.doc);
      expect(applied).toContain("code");
      expect(applied).toContain(name);

      const saved = prosemirrorToMarkdown(editor!.state.doc);
      const reopened = markdownToProsemirror(saved, editor!.schema);

      // 다시 연 문서가 같은 마크를 갖는다 — 여기서 셋이 red였다.
      expect(allMarksIn(reopened)).toEqual(applied);
      // 그리고 두 번째 저장이 같은 바이트를 쓴다 (열고 저장만 해도 파일이 바뀌면 안 된다).
      expect(prosemirrorToMarkdown(reopened)).toBe(saved);
    },
  );

  // 마크다운 원문 형태가 바이트 그대로 보존되는지 — 위와 달리 디스크 왕복만 본다.
  it.each([
    ["bold", "**`c`**\n"],
    ["italic", "*`c`*\n"],
    ["strike", "~~`c`~~\n"],
    ["underline", "<u>`c`</u>\n"],
    ["highlight (HTML 형태)", "<mark>`c`</mark>\n"],
    ["subscript (HTML 형태)", "<sub>`c`</sub>\n"],
    ["superscript (HTML 형태)", "<sup>`c`</sup>\n"],
    ["link", "[`c`](https://example.com)\n"],
    ["bold+italic", "***`c`***\n"],
    ["마크 없는 코드 (회귀 확인)", "`c`\n"],
    ["평문 강조 단축 구문은 그대로 (churn 방지)", "==plain==\n"],
  ])("code + %s 가 바이트 그대로 왕복한다", (_label, input) => {
    expect(
      prosemirrorToMarkdown(markdownToProsemirror(input, editor!.schema)),
    ).toBe(input);
  });
});
