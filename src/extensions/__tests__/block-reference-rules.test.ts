// §275.5 Block Reference InputRule + PasteRule — typed/pasted ((...)) becomes
// a node immediately instead of waiting for a save-and-reopen pipeline pass.
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { describe, expect, it } from "vitest";

import { BLOCK_REF_RE } from "../../pipeline/block-id";
import { BlockReference } from "../nodes/block-reference";
import { Paragraph } from "../nodes/paragraph";

class MockClipboardEvent extends Event {
  readonly clipboardData: DataTransfer | null;
  constructor(type: string, eventInit?: { clipboardData?: DataTransfer }) {
    super(type);
    this.clipboardData = eventInit?.clipboardData ?? null;
  }
}

// jsdom implements neither `ClipboardEvent` nor `DataTransfer`. Tiptap's
// simulated-paste path (insertContentAt's `applyPasteRules` option, used
// below to exercise addPasteRules()/nodePasteRule without a real DOM paste)
// unconditionally constructs a `ClipboardEvent` internally
// (createClipboardPasteEvent in @tiptap/core's PasteRule.ts), so both need a
// minimal polyfill here, scoped to this test file only. See
// wikilink.test.ts:19-49 for the source of this pattern.
class MockDataTransfer {
  private store = new Map<string, string>();
  getData(format: string): string {
    return this.store.get(format) ?? "";
  }
  setData(format: string, data: string): void {
    this.store.set(format, data);
  }
}

if (typeof globalThis.DataTransfer === "undefined") {
  globalThis.DataTransfer = MockDataTransfer as unknown as typeof DataTransfer;
}
if (typeof globalThis.ClipboardEvent === "undefined") {
  globalThis.ClipboardEvent =
    MockClipboardEvent as unknown as typeof ClipboardEvent;
}

// --- Regex-domain tests (brief Step 1): cheap, document intent up front ---

describe("BlockReference rules", () => {
  it("registers an input rule and a paste rule", () => {
    // 이 둘이 없으면 붙여넣은 ((...))가 저장·재오픈 전까지 생텍스트로 남는다
    expect(typeof BlockReference.config.addInputRules).toBe("function");
    expect(typeof BlockReference.config.addPasteRules).toBe("function");
  });

  it("anchors the input regex to the end so it fires on the closing ))", () => {
    const anchored = new RegExp(`${BLOCK_REF_RE.source}$`);

    expect(anchored.test("prose ((notes/a#^abc123))")).toBe(true);
    // 뒤에 글자가 더 있으면 아직 타이핑 중 — 발동하지 않아야 한다
    expect(anchored.test("((notes/a#^abc123)) trailing")).toBe(false);
  });

  it("matches every occurrence when the paste regex carries the g flag", () => {
    const global = new RegExp(BLOCK_REF_RE.source, "g");
    const pasted = "((notes/a#^abc123|first)) and ((notes/b#^def456|second))";

    expect(pasted.match(global)).toHaveLength(2);
  });

  it("parses a path-qualified target with a display label", () => {
    const match = new RegExp(BLOCK_REF_RE.source, "g").exec(
      "((highlights/papers/attention#^h7k2m9|Attention mechanisms))",
    );

    expect(match).not.toBeNull();
    expect(match![1]).toBe("highlights/papers/attention");
    expect(match![2]).toBe("h7k2m9");
    expect(match![3]).toBe("Attention mechanisms");
  });
});

// --- Behavioral tests: drive a real Editor so presence-only assertions
// can't pass an empty addInputRules()/addPasteRules() implementation, and
// the "$"/"g" regex details above are actually exercised end to end. ---

function collectRefBlockIds(doc: Editor["state"]["doc"]): string[] {
  const ids: string[] = [];
  doc.firstChild!.forEach((node) => {
    if (node.type.name === "blockReference") {
      ids.push(node.attrs.blockId as string);
    }
  });
  return ids;
}

function createBlockRefEditor(): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, BlockReference],
    content: "<p></p>",
  });
}

function pasteText(editor: Editor, text: string): void {
  const insertPos = editor.state.doc.content.size - 1;
  editor.commands.insertContentAt(insertPos, text, { applyPasteRules: true });
}

/**
 * Simulates the user finishing typing `((...))` by hand: the literal text
 * is inserted into the doc, then the InputRule plugin's `handleTextInput`
 * prop is invoked directly at the caret — the same prop ProseMirror's DOM
 * input handling calls on a real keystroke — so the BlockReference
 * InputRule handler actually runs. See wikilink.test.ts:632-639.
 */
function typeBlockRef(editor: Editor, text: string): void {
  const insertPos = editor.state.doc.content.size - 1;
  editor.commands.insertContentAt(insertPos, text);
  const endPos = editor.state.doc.content.size - 1;
  editor.view.someProp("handleTextInput", (f) =>
    f(editor.view, endPos, endPos, "", () => editor.state.tr),
  );
}

describe("InputRule: block reference typed conversion", () => {
  it("converts a typed ((target#^blockId|display)) into a blockReference node", () => {
    const editor = createBlockRefEditor();
    typeBlockRef(
      editor,
      "((highlights/papers/attention#^h7k2m9|Attention mechanisms))",
    );
    const node = editor.state.doc.firstChild!.firstChild!;
    expect(node.type.name).toBe("blockReference");
    expect(node.attrs.target).toBe("highlights/papers/attention");
    expect(node.attrs.blockId).toBe("h7k2m9");
    expect(node.attrs.display).toBe("Attention mechanisms");
    editor.destroy();
  });

  // Documents intent: characters after the caret mean the user is still
  // typing, so the rule must not fire yet. (Tiptap's own InputRule runtime
  // independently re-validates that a match ends exactly at the caret, so
  // this particular case doesn't by itself discriminate a missing `$` —
  // see the next test for that.)
  it("does not fire when characters follow the closing )) at the caret", () => {
    const editor = createBlockRefEditor();
    typeBlockRef(editor, "((notes/a#^abc123)) trailing");
    const para = editor.state.doc.firstChild!;
    expect(collectRefBlockIds(editor.state.doc)).toEqual([]);
    expect(para.textContent).toBe("((notes/a#^abc123)) trailing");
    editor.destroy();
  });

  // Pins the `$` anchor for real: two refs typed in one go, where only the
  // second one ends at the caret. Without `$`, `find.exec()` (called once,
  // non-`g`) returns the *leftmost* match — the first ref — which doesn't
  // end at the caret, so Tiptap's position check rejects it and NEITHER ref
  // converts. With `$`, the engine skips the first `((` and matches
  // starting at the second, which does end at the caret.
  it("converts the caret-adjacent ref even when an earlier (( appears in the same input", () => {
    const editor = createBlockRefEditor();
    typeBlockRef(editor, "((notes/a#^abc123)) and ((notes/b#^def456))");
    expect(collectRefBlockIds(editor.state.doc)).toEqual(["def456"]);
    editor.destroy();
  });
});

describe("PasteRule: block reference paste conversion", () => {
  it("converts a pasted block reference into a node (not raw text)", () => {
    const editor = createBlockRefEditor();
    pasteText(
      editor,
      "((highlights/papers/attention#^h7k2m9|Attention mechanisms))",
    );
    const node = editor.state.doc.firstChild!.firstChild!;
    expect(node.type.name).toBe("blockReference");
    expect(node.attrs.target).toBe("highlights/papers/attention");
    expect(node.attrs.blockId).toBe("h7k2m9");
    expect(node.attrs.display).toBe("Attention mechanisms");
    editor.destroy();
  });

  // Pins the `g` flag: without it only the first reference in the pasted
  // text would convert.
  it("converts both references when pasting two occurrences in one paste", () => {
    const editor = createBlockRefEditor();
    pasteText(
      editor,
      "((notes/a#^abc123|first)) and ((notes/b#^def456|second))",
    );
    expect(collectRefBlockIds(editor.state.doc)).toEqual(["abc123", "def456"]);
    editor.destroy();
  });
});

// --- §276.6 width attribute ---

function firstRef(editor: Editor) {
  return editor.state.doc.firstChild!.firstChild!;
}

describe("§276.6 width attribute through the rules", () => {
  it("carries |w=NN from a typed reference onto the node", () => {
    const editor = createBlockRefEditor();
    typeBlockRef(editor, "((notes/a#^abc123|Attention|w=60))");
    const node = firstRef(editor);
    expect(node.attrs.display).toBe("Attention");
    expect(node.attrs.width).toBe(60);
    editor.destroy();
  });

  it("carries a width-only reference from a paste", () => {
    const editor = createBlockRefEditor();
    pasteText(editor, "((notes/a#^abc123|w=75))");
    const node = firstRef(editor);
    expect(node.attrs.display).toBeNull();
    expect(node.attrs.width).toBe(75);
    editor.destroy();
  });

  it("leaves an out-of-range w=200 as display text", () => {
    const editor = createBlockRefEditor();
    pasteText(editor, "((notes/a#^abc123|w=200))");
    const node = firstRef(editor);
    expect(node.attrs.display).toBe("w=200");
    expect(node.attrs.width).toBeNull();
    editor.destroy();
  });
});

// The clipboard carries HTML, not markdown: a reference copied inside the
// editor takes the renderHTML → parseHTML path, so a width that survives the
// markdown pipeline can still be lost here. These pin that path directly.
describe("§276.6 width survives the HTML round-trip", () => {
  function htmlRoundTrip(attrs: Record<string, unknown>) {
    const editor = createBlockRefEditor();
    editor.commands.insertContent({ type: "blockReference", attrs });
    const html = editor.getHTML();
    editor.commands.setContent(html);
    const node = firstRef(editor);
    const result = { html, attrs: { ...node.attrs } };
    editor.destroy();
    return result;
  }

  it("renders data-width and reads it back", () => {
    const { attrs, html } = htmlRoundTrip({
      target: "notes/a",
      blockId: "abc123",
      display: "Attention",
      width: 60,
    });
    expect(html).toContain('data-width="60"');
    expect(attrs.width).toBe(60);
    expect(attrs.display).toBe("Attention");
  });

  it("omits data-width entirely when there is no width", () => {
    const { attrs, html } = htmlRoundTrip({
      target: "notes/a",
      blockId: "abc123",
      display: "Attention",
    });
    expect(html).not.toContain("data-width");
    expect(attrs.width).toBeNull();
  });

  it("rejects a hand-written data-width outside 10..100 or non-integer", () => {
    const editor = createBlockRefEditor();
    for (const bad of ["200", "5", "60.5", "abc", ""]) {
      editor.commands.setContent(
        `<p><span data-type="block-reference" data-target="notes/a" data-block-id="abc123" data-width="${bad}">x</span></p>`,
      );
      expect(firstRef(editor).attrs.width).toBeNull();
    }
    editor.destroy();
  });
});
