// §278.1 Link mark 클릭 라우팅 — 앱 내 열기 vs OS opener.
//
// ‼️ 이 스위트는 **진짜 Tiptap 에디터에 진짜 mousedown을 보낸다.** 라우팅 함수를
// 직접 부르면 셋 중 무엇도 검증되지 않는다: 렌더된 `<a>`가 실제로 잡히는지,
// ProseMirror가 mousedown을 우리 핸들러까지 흘리는지, meta 키 게이트가 맞는지.
// 우리를 여기까지 오게 한 결함(§278의 인라인 링크 누수)이 정확히 그 층에 있었다.
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

import { Link } from "../marks/link";
import { Paragraph } from "../nodes/paragraph";

/** 렌더된 앵커에 Cmd 누른 mousedown. 실제 사용자 동작과 같은 경로. */
function cmdClickAnchor(element: HTMLElement): boolean {
  const anchor = element.querySelector("a");
  if (!anchor) throw new Error("link mark did not render an <a> element");
  return !anchor.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    }),
  );
}

/** 링크 하나를 담은 에디터. `onNavigateLocal`이 무엇을 반환할지 지정한다. */
function mountLink(href: string, handled: boolean) {
  const onNavigateLocal = vi.fn(() => handled);
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    content: `<p><a href="${href}">label</a></p>`,
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Link.configure({ onNavigateLocal }),
    ],
  });
  return { editor, element, onNavigateLocal };
}

beforeEach(() => {
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
  logger.error.mockClear();
  document.body.innerHTML = "";
});

describe("§278.1 scheme-less hrefs are offered to the app first", () => {
  it("does NOT reach the OS opener when the app handles the href", () => {
    // 이것이 회귀 테스트다: 예전 isLocalFileLink는 .md만 인정해
    // `[label](Paper.pdf)`를 곧장 openUrl로 넘겼다.
    const { element, onNavigateLocal } = mountLink("Paper.pdf", true);
    const prevented = cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("Paper.pdf");
    expect(openUrl).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it("falls back to the OS opener when the app declines the href", () => {
    // 스킴 없는 외부 주소(www.example.com)가 계속 열리는 이유.
    const { element, onNavigateLocal } = mountLink("www.example.com", false);
    cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("www.example.com");
    expect(openUrl).toHaveBeenCalledWith("www.example.com");
  });

  it("offers a markdown href to the app, exactly as before", () => {
    const { element, onNavigateLocal } = mountLink("sub/doc.md", true);
    cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("sub/doc.md");
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("§278.1 hrefs the app is never asked about", () => {
  it("sends an http URL straight to the OS opener", () => {
    const { element, onNavigateLocal } = mountLink(
      "https://example.com/a",
      true,
    );
    cmdClickAnchor(element);

    // handled=true인데도 호출되지 않아야 한다 — 스킴이 있으면 질문 자체를 안 한다.
    expect(onNavigateLocal).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("sends a mailto URL straight to the OS opener", () => {
    const { element, onNavigateLocal } = mountLink("mailto:a@b.com", true);
    cmdClickAnchor(element);

    expect(onNavigateLocal).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("mailto:a@b.com");
  });

  it("keeps a #fragment in the document even when the app declines it", () => {
    // ‼️ 프래그먼트는 이 문서 자신을 가리킨다. 반환값과 무관하게 openUrl로
    // 새면 안 된다 — 네비게이션이 전부 no-op인 §89 단독 창에서 실제로 난다.
    const { element, onNavigateLocal } = mountLink("#heading", false);
    cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("#heading");
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("§278.1 the click gate itself", () => {
  it("ignores a plain click — no modifier, no navigation", () => {
    const { element, onNavigateLocal } = mountLink("Paper.pdf", true);
    const anchor = element.querySelector("a");
    anchor?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(onNavigateLocal).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("defaults to declining, so an unconfigured editor still opens URLs", () => {
    // createBaramExtensions의 기본값이 바뀌면 여기서 걸린다.
    const element = document.createElement("div");
    document.body.appendChild(element);
    new Editor({
      content: `<p><a href="www.example.com">label</a></p>`,
      element,
      extensions: [Document, Paragraph, Text, Link],
    });
    cmdClickAnchor(element);

    expect(openUrl).toHaveBeenCalledWith("www.example.com");
  });
});

// ─── issue 499 — link destinations outside the policy are never live ─────────
//
// The model keeps whatever the file said (pinned in pipeline roundtrip.test.ts);
// what changes is what reaches the DOM, the clipboard and the OS. Every case
// below builds the mark from JSON on purpose: `<a href>` content would go
// through parseHTML, which now refuses these hrefs before a mark exists.

function mountLinkMark(
  attrs: Record<string, unknown>,
  options: { HTMLAttributes?: Record<string, string> } = {},
) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "label", marks: [{ type: "link", attrs }] },
          ],
        },
      ],
    },
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Link.configure({ onNavigateLocal: () => false, ...options }),
    ],
  });
  return { editor, element };
}

const REFUSED_HREFS = [
  "javascript:alert(1)",
  "java\tscript:alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "blob:https://example.com/0b3c",
];

describe("issue 499 — rendering", () => {
  it.each(REFUSED_HREFS)(
    "keeps %j in the model but renders the anchor without href",
    (href) => {
      const { editor, element } = mountLinkMark({ href, title: "why" });
      const mark = editor.state.doc.firstChild!.firstChild!.marks.find(
        (m) => m.type.name === "link",
      );
      expect(mark?.attrs.href).toBe(href);

      const anchor = element.querySelector("a");
      expect(anchor).not.toBeNull();
      expect(anchor!.hasAttribute("href")).toBe(false);
      // The destination survives as an inert `data-href` — the clipboard
      // and CSS hook — never as anything the browser navigates.
      expect(anchor!.getAttribute("data-href")).toBe(href);
      // Only the wire is cut — the title is not a vector.
      expect(anchor!.getAttribute("title")).toBe("why");
      expect(editor.getHTML()).not.toContain(" href=");
    },
  );

  it("does not add data-href to an allowed link", () => {
    const { element } = mountLinkMark({ href: "https://example.com/a" });
    expect(element.querySelector("a")!.hasAttribute("data-href")).toBe(false);
  });

  it("classifies the FINAL merged attributes, so a configured HTMLAttributes.href cannot smuggle one back in", () => {
    const { element } = mountLinkMark(
      { href: null },
      { HTMLAttributes: { href: "javascript:alert(1)", rel: "noopener" } },
    );
    const anchor = element.querySelector("a")!;
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.getAttribute("rel")).toBe("noopener");
  });

  it("leaves an allowed href alone, including one that merely contains the text javascript:", () => {
    const href = "https://example.test/?q=javascript:alert(1)";
    const { element } = mountLinkMark({ href });
    expect(element.querySelector("a")!.getAttribute("href")).toBe(href);
  });

  it("serialises clipboard HTML through the same renderer", () => {
    const { editor } = mountLinkMark({ href: "javascript:alert(1)" });
    const { dom } = editor.view.serializeForClipboard(
      editor.state.doc.slice(0),
    );
    expect(dom.innerHTML).toContain("label");
    expect(dom.innerHTML).not.toContain(" href=");
    expect(dom.innerHTML).toContain('data-href="javascript:alert(1)"');
  });

  it("round-trips a refused link through the clipboard — cut and paste keeps the mark", () => {
    // Review finding: with only `href` withheld, copying `[note](file:///…)`
    // and pasting it back produced plain text, so an ordinary cut-and-paste
    // silently deleted the link from the saved file.
    const { editor } = mountLinkMark({ href: "file:///Users/me/a.md" });
    const { dom } = editor.view.serializeForClipboard(
      editor.state.doc.slice(0),
    );
    // The clipboard HTML is already block-level (`<p data-pm-slice…>`) —
    // feed it back exactly as another paste would.
    editor.commands.setContent(dom.innerHTML);
    const hrefs: string[] = [];
    editor.state.doc.descendants((node) => {
      for (const m of node.marks) {
        if (m.type.name === "link") hrefs.push(String(m.attrs.href));
      }
    });
    expect(hrefs).toEqual(["file:///Users/me/a.md"]);
    // …and it comes back inert again.
    expect(editor.getHTML()).not.toContain(" href=");
  });
});

describe("issue 499 — navigation", () => {
  it("refuses to hand a refused href to the OS even when a live anchor carries it", () => {
    // Our renderer no longer produces such an anchor; this plants one to prove
    // the click path does not trust the DOM either.
    const { element } = mountLinkMark({ href: "javascript:alert(1)" });
    element.querySelector("a")!.setAttribute("href", "javascript:alert(1)");

    const prevented = cmdClickAnchor(element);

    expect(openUrl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(prevented).toBe(true);
  });
});

describe("issue 499 — pasted HTML", () => {
  function pasteOf(html: string) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      content: html,
      element,
      extensions: [Document, Paragraph, Text, Link],
    });
    const hrefs: string[] = [];
    editor.state.doc.descendants((node) => {
      for (const m of node.marks) {
        if (m.type.name === "link") hrefs.push(String(m.attrs.href));
      }
    });
    return { hrefs, text: editor.state.doc.textContent };
  }

  it.each([
    '<a href="vbscript:msgbox(1)">t</a>',
    '<a href="data:text/html,x">t</a>',
    '<a href="blob:https://example.com/0b3c">t</a>',
    '<a href="JAVASCRIPT:alert(1)">t</a>',
    // Entity-encoded — the HTML parser decodes these before the rule sees
    // the attribute, so a substring check on the source text would miss them.
    '<a href="java&#x09;script:alert(1)">t</a>',
    '<a href="&#106;avascript:alert(1)">t</a>',
  ])("drops the link mark and keeps the text for %s", (anchor) => {
    const { hrefs, text } = pasteOf(`<p>${anchor}</p>`);
    expect(hrefs).toEqual([]);
    expect(text).toBe("t");
  });

  it("no longer over-blocks an https href that merely contains javascript:", () => {
    const href = "https://example.test/?q=javascript:alert(1)";
    const { hrefs } = pasteOf(`<p><a href="${href}">t</a></p>`);
    expect(hrefs).toEqual([href]);
  });

  it("accepts our own inert form — data-href without href — back into the model", () => {
    const { hrefs } = pasteOf(
      '<p><a data-href="obsidian://open?vault=v">t</a></p>',
    );
    expect(hrefs).toEqual(["obsidian://open?vault=v"]);
  });

  it("lets a live href win over data-href, and still refuses it when it must", () => {
    expect(
      pasteOf(
        '<p><a href="https://example.com/a" data-href="javascript:x">t</a></p>',
      ).hrefs,
    ).toEqual(["https://example.com/a"]);
    expect(
      pasteOf('<p><a href="javascript:x" data-href="https://ok">t</a></p>')
        .hrefs,
    ).toEqual([]);
  });
});

describe("issue 499 — the typed input rule", () => {
  it("creates the mark the user typed and still renders it inert", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      content: "<p></p>",
      element,
      extensions: [Document, Paragraph, Text, Link],
    });
    // Same shape as block-reference-rules.test.ts: insert the literal text,
    // then invoke the InputRule plugin's handleTextInput at the caret.
    const insertPos = editor.state.doc.content.size - 1;
    editor.commands.insertContentAt(insertPos, "[x](javascript:top.name)");
    const endPos = editor.state.doc.content.size - 1;
    editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, endPos, endPos, "", () => editor.state.tr),
    );

    const textNode = editor.state.doc.firstChild!.firstChild!;
    expect(textNode.text).toBe("x");
    expect(textNode.marks[0]?.attrs.href).toBe("javascript:top.name");
    expect(element.querySelector("a")!.hasAttribute("href")).toBe(false);
  });
});
