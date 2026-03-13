import { Editor } from "@tiptap/core";
// §5.1 Cursor mapper — character-level text matching tests
import { describe, expect, test } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { mdOffsetToPmPos, pmPosToMdOffset } from "../cursor-mapper";

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

function loadDoc(editor: Editor, md: string) {
  return markdownToProsemirror(md, editor.schema);
}

describe("cursor-mapper: pmPosToMdOffset", () => {
  const editor = createEditor();

  test("heading: cursor after '## ' prefix maps correctly", () => {
    const md = "## Hello World";
    const doc = loadDoc(editor, md);
    // PM: heading content starts at pos 1, "Hello World" = 11 chars
    // Cursor at start of heading content (pos 1) → MD offset should be after "## "
    const offset = pmPosToMdOffset(doc, 1, md);
    expect(md[offset]).toBe("H");
    expect(offset).toBe(3); // "## " = 3 chars
  });

  test("heading: cursor in middle of heading text", () => {
    const md = "## Hello World";
    const doc = loadDoc(editor, md);
    // Cursor after "Hello" (pos 1 + 5 = 6)
    const offset = pmPosToMdOffset(doc, 6, md);
    expect(md.substring(3, 3 + 5)).toBe("Hello");
    expect(offset).toBe(8); // "## Hello" = 8
  });

  test("h1: single # prefix", () => {
    const md = "# Title";
    const doc = loadDoc(editor, md);
    const offset = pmPosToMdOffset(doc, 1, md);
    expect(offset).toBe(2); // "# " = 2 chars
  });

  test("paragraph: no syntax, direct mapping", () => {
    const md = "Hello World";
    const doc = loadDoc(editor, md);
    const offset = pmPosToMdOffset(doc, 6, md);
    // pos 1 = start of paragraph content; pos 6 = after "Hello"
    expect(offset).toBe(5); // "Hello" = 5 chars
  });

  test("bold: skips ** markers", () => {
    const md = "This is **bold** text";
    const doc = loadDoc(editor, md);
    // PM text: "This is bold text" (17 chars)
    // Cursor after "bold" in PM = pos 1 + 12 = 13
    // In MD: "This is **bold**" = 16, so cursor should be at 16
    const offset = pmPosToMdOffset(doc, 13, md);
    expect(md.substring(0, offset)).toBe("This is **bold**");
    expect(offset).toBe(16);
  });

  test("italic: skips * markers", () => {
    const md = "An *italic* word";
    const doc = loadDoc(editor, md);
    // PM text: "An italic word" (14 chars)
    // Cursor after "italic" = pos 1 + 10 = 11 (content pos: "An italic" = 9 chars + 1 space)
    // Wait, "An " = 3, "italic" = 6 → after "italic" = 9
    const offset = pmPosToMdOffset(doc, 10, md);
    expect(md.substring(0, offset)).toBe("An *italic*");
  });

  test("link: skips [, ](url) syntax", () => {
    const md = "Click [here](https://example.com) please";
    const doc = loadDoc(editor, md);
    // PM text: "Click here please" (17 chars)
    // Cursor after "here" = pos 1 + 10 = 11
    const offset = pmPosToMdOffset(doc, 11, md);
    expect(md.substring(0, offset)).toBe("Click [here](https://example.com)");
  });

  test("multi-block: second paragraph", () => {
    const md = "First paragraph\n\nSecond paragraph";
    const doc = loadDoc(editor, md);
    // First paragraph: pos 1..16 (content.size=15)
    // Second paragraph starts at pos 18 (16+1 close + 1 open)
    // Cursor at start of "Second" = pos 18
    const offset = pmPosToMdOffset(doc, 18, md);
    expect(md.substring(offset, offset + 6)).toBe("Second");
  });

  test("code block: skips fences", () => {
    const md = "```js\nconsole.log(1)\n```";
    const doc = loadDoc(editor, md);
    // PM code block content: "console.log(1)"
    // Cursor at "console" start = pos 1 (content start)
    const offset = pmPosToMdOffset(doc, 1, md);
    // Should be after "```js\n"
    expect(md.substring(offset, offset + 7)).toBe("console");
  });
});

describe("cursor-mapper: mdOffsetToPmPos", () => {
  const editor = createEditor();

  test("heading: cursor after '## ' maps to heading content start", () => {
    const md = "## Hello World";
    const doc = loadDoc(editor, md);
    // MD offset 3 = after "## " → PM pos should be 1 (start of heading content)
    const pos = mdOffsetToPmPos(doc, 3, md);
    expect(pos).toBe(1);
  });

  test("heading: cursor in middle of text", () => {
    const md = "## Hello World";
    const doc = loadDoc(editor, md);
    // MD offset 8 = after "## Hello" → PM pos after "Hello" = 1 + 5 = 6
    const pos = mdOffsetToPmPos(doc, 8, md);
    expect(pos).toBe(6);
  });

  test("bold: cursor after closing **", () => {
    const md = "This is **bold** text";
    const doc = loadDoc(editor, md);
    // MD offset 16 = after "This is **bold**" → PM after "This is bold" = 1 + 12 = 13
    const pos = mdOffsetToPmPos(doc, 16, md);
    expect(pos).toBe(13);
  });

  test("link: cursor after ](url)", () => {
    const md = "Click [here](https://example.com) please";
    const doc = loadDoc(editor, md);
    // MD offset 33 = after "Click [here](https://example.com)" → PM after "Click here" = 1 + 10 = 11
    const pos = mdOffsetToPmPos(doc, 33, md);
    expect(pos).toBe(11);
  });

  test("code block: cursor in code content", () => {
    const md = "```js\nconsole.log(1)\n```";
    const doc = loadDoc(editor, md);
    // MD offset 6 = start of "console" → PM pos 1
    const pos = mdOffsetToPmPos(doc, 6, md);
    expect(pos).toBe(1);
  });
});

describe("cursor-mapper: round-trip", () => {
  const editor = createEditor();

  function roundTrip(md: string, pmPos: number): number {
    const doc = loadDoc(editor, md);
    const mdOffset = pmPosToMdOffset(doc, pmPos, md);
    return mdOffsetToPmPos(doc, mdOffset, md);
  }

  test.each([
    ["plain paragraph", "Hello World", 6],
    ["heading start", "## Hello World", 1],
    ["heading middle", "## Hello World", 6],
    ["heading end", "## Hello World", 12],
    ["bold before", "This is **bold** text", 8],
    ["bold middle", "This is **bold** text", 11],
    ["bold after", "This is **bold** text", 13],
    ["italic", "An *italic* word", 5],
    ["code span", "Use `code` here", 5],
    ["h3 heading", "### Deep heading", 1],
  ])("round-trip preserves position: %s", (_, md, pmPos) => {
    expect(roundTrip(md, pmPos)).toBe(pmPos);
  });

  test("round-trip via serialize: heading", () => {
    const md = "## Hello World";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // Cursor at pos 6 (after "Hello")
    const mdOffset = pmPosToMdOffset(doc, 6, serialized);
    const newDoc = loadDoc(editor, serialized);
    const pmPos = mdOffsetToPmPos(newDoc, mdOffset, serialized);
    expect(pmPos).toBe(6);
  });

  test("round-trip via serialize: bold text", () => {
    const md = "Some **important** info";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // Cursor after "important" in PM = 1 + 14 = 15
    const mdOffset = pmPosToMdOffset(doc, 15, serialized);
    const newDoc = loadDoc(editor, serialized);
    const pmPos = mdOffsetToPmPos(newDoc, mdOffset, serialized);
    expect(pmPos).toBe(15);
  });
});

describe("cursor-mapper: serialize round-trip (real toggle path)", () => {
  const editor = createEditor();

  // Simulate the exact WYSIWYG → Source → WYSIWYG toggle path
  function serializeRoundTrip(
    md: string,
    pmPos: number,
  ): { mdOffset: number; roundTripPos: number; serialized: string } {
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    const mdOffset = pmPosToMdOffset(doc, pmPos, serialized);
    const newDoc = loadDoc(editor, serialized);
    const roundTripPos = mdOffsetToPmPos(newDoc, mdOffset, serialized);
    return { mdOffset, roundTripPos, serialized };
  }

  test.each([
    ["plain paragraph start", "Hello World", 1],
    ["plain paragraph middle", "Hello World", 6],
    ["plain paragraph end", "Hello World", 12],
    ["heading start", "## Hello World", 1],
    ["heading middle", "## Hello World", 6],
    ["bold start", "This is **bold** text", 9],
    ["bold end", "This is **bold** text", 13],
    ["italic", "An *italic* word", 4],
    ["link text", "Click [here](https://x.com) now", 7],
    ["code span", "Use `code` here", 5],
    ["multi-para first", "First line\n\nSecond line", 1],
    ["multi-para second", "First line\n\nSecond line", 14],
    ["Korean text", "안녕하세요 세계", 4],
    ["mixed Korean-English", "Hello 안녕 World", 7],
    ["heading with bold", "## Hello **World**", 1],
    ["heading with bold end", "## Hello **World**", 12],
    ["strikethrough", "Some ~~deleted~~ text", 6],
    // Compound blocks: cursor must be inside text, not at wrapper boundary
    ["blockquote start", "> quoted text", 2],
    ["blockquote middle", "> quoted text", 6],
    ["blockquote Korean", "> 인용문을 작성할 수 있습니다.", 5],
    ["bullet list start", "- list item", 3],
    ["bullet list middle", "- list item", 7],
    ["ordered list start", "1. ordered item", 3],
    ["ordered list middle", "1. ordered item", 8],
    // Nested lists: sub-bullet text must round-trip correctly
    ["nested bullet parent", "- parent\n  - child", 4],
    ["nested bullet child start", "- parent\n  - child", 13],
    ["nested bullet child middle", "- parent\n  - child", 15],
    ["nested ordered", "1. first\n   1. second", 14],
    // Inline atom nodes (tagNode): cursor in TEXT near atoms must round-trip.
    // Atom boundaries are inherently lossy (atom=1 PM pos but 0 text chars),
    // so we test cursor positions within surrounding text nodes.
    // "Hello #world tag" → text("Hello ",6) + tagNode(1) + text(" tag",4) → content.size=11
    ["tag: in text before tag", "Hello #world tag", 4],
    ["tag: text end before tag", "Hello #world tag", 6],
    ["tag: text start after tag", "Hello #world tag", 8],
    ["tag: in text after tag", "Hello #world tag", 10],
    ["tag: content end after tag", "Hello #world tag", 12],
    // "#hello and #world" → tagNode(1) + text(" and ",5) + tagNode(1) → content.size=7
    ["tag: text between two tags start", "#hello and #world", 2],
    ["tag: text between two tags mid", "#hello and #world", 4],
    ["tag: text between two tags end", "#hello and #world", 6],
    // "오늘 #일기 쓰기" → text("오늘 ",3) + tagNode(1) + text(" 쓰기",3) → content.size=7
    ["tag: Korean before tag", "오늘 #일기 쓰기", 2],
    ["tag: Korean after tag", "오늘 #일기 쓰기", 6],
    // "text #project/baram end" → text("text ",5) + tagNode(1) + text(" end",4) → content.size=10
    ["tag: nested tag before", "text #project/baram end", 3],
    ["tag: nested tag after", "text #project/baram end", 9],
    // Compound blocks: bulletList with tag-only items (atom-only leaf blocks)
    // Must correctly count textBetween separators between ALL leaf blocks.
    ["list: text in first item", "- hello\n- world", 3],
    ["list: text in second item", "- hello\n- world", 12],
    ["list: tag then text item", "- #note\n- hello", 10],
    ["list: text then tag then text", "- first\n- #tag\n- last", 3],
    ["list: text then tag then text end", "- first\n- #tag\n- last", 18],
  ])("serialize round-trip preserves: %s", (_, md, pmPos) => {
    const { roundTripPos } = serializeRoundTrip(md, pmPos);
    expect(roundTripPos).toBe(pmPos);
  });

  test("pmPosToMdOffset places cursor correctly in serialized output", () => {
    const md = "Hello World";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // PM pos 6 = after "Hello" → MD offset should point between "Hello" and " World"
    const mdOffset = pmPosToMdOffset(doc, 6, serialized);
    expect(serialized[mdOffset]).toBe(" ");
    expect(serialized.substring(0, mdOffset)).toBe("Hello");
  });

  test("pmPosToMdOffset for heading in serialized output", () => {
    const md = "## Title";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // PM pos 1 = start of heading content → after "## "
    const mdOffset = pmPosToMdOffset(doc, 1, serialized);
    expect(serialized[mdOffset]).toBe("T");
  });

  test("tagNode: forward mapping places cursor correctly in markdown", () => {
    const md = "Hello #world tag";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // PM: text("Hello ") + tagNode + text(" tag")
    // PM pos 1 = start of paragraph content
    // tagNode is at offset 6 (after "Hello "), size 1
    // text " tag" starts at offset 7

    // Cursor right after tagNode (PM pos = 1 + 7 = 8) → MD should be after "#world"
    const offset = pmPosToMdOffset(doc, 8, serialized);
    expect(serialized.substring(0, offset)).toBe("Hello #world");
  });

  test("tagNode: multiple tags don't accumulate cursor drift", () => {
    const md = "#hello and #world";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);

    // Cursor in text between tags — should NOT drift by tag count
    // PM: tagNode(hello) + text(" and ") + tagNode(world) → content.size=7
    // Cursor in " and " (offset 3) → PM pos = 1 + 3 = 4
    const offset = pmPosToMdOffset(doc, 4, serialized);
    const mdText = serialized.replace(/\n$/, "");
    // Should point within "#hello and #world", not beyond
    expect(offset).toBeLessThanOrEqual(mdText.length);
    expect(offset).toBeGreaterThan(0);
  });

  test("tagNode: cursor stays in same paragraph after multi-line round-trip", () => {
    // REGRESSION: before fix, cursor drifted down by N (number of tags) lines
    const md = "Hello #tag1 and #tag2 text\n\nSecond paragraph";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);

    // Test multiple positions in the first paragraph (which has 2 tags)
    // PM: text("Hello ",6) + tagNode(1) + text(" and ",5) + tagNode(1) + text(" text",5) → content.size=18
    // Cursor in " text" after 2nd tag: offset 13 + 1 (para open) = pmPos 14
    const mdOffset = pmPosToMdOffset(doc, 14, serialized);
    const newDoc = loadDoc(editor, serialized);
    const roundTripPos = mdOffsetToPmPos(newDoc, mdOffset, serialized);

    // Must stay in first paragraph (pos 1..19), NOT jump to second paragraph
    const firstParaEnd = 1 + doc.child(0).content.size;
    expect(roundTripPos).toBeGreaterThanOrEqual(1);
    expect(roundTripPos).toBeLessThanOrEqual(firstParaEnd);
    // And round-trip should be exact for text positions
    expect(roundTripPos).toBe(14);
  });

  test("tagNode: trailing atom — before vs after cursor roundtrips correctly", () => {
    // "hello #tag" → text("hello ",6) + tagNode(1) → content.size=7
    const md = "hello #tag";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // Cursor before trailing tag: PM pos = 1 + 6 = 7
    const mdBefore = pmPosToMdOffset(doc, 7, serialized);
    // Cursor after trailing tag: PM pos = 1 + 7 = 8 (content.size)
    const mdAfter = pmPosToMdOffset(doc, 8, serialized);
    // These MUST be different — before should be at '#', after should be past 'g'
    expect(mdBefore).not.toBe(mdAfter);
    expect(serialized[mdBefore]).toBe("#");
    expect(mdAfter).toBe(serialized.trimEnd().length); // end of "hello #tag"
    // Roundtrip both
    const newDoc = loadDoc(editor, serialized);
    expect(mdOffsetToPmPos(newDoc, mdBefore, serialized)).toBe(7);
    expect(mdOffsetToPmPos(newDoc, mdAfter, serialized)).toBe(8);
  });

  test("tagNode: atom-only paragraph — before vs after cursor roundtrips", () => {
    // "#tag" alone → tagNode(1) → content.size=1
    const md = "#tag";
    const doc = loadDoc(editor, md);
    const serialized = prosemirrorToMarkdown(doc);
    // Cursor before atom: PM pos = 1 (content start)
    const mdBefore = pmPosToMdOffset(doc, 1, serialized);
    // Cursor after atom: PM pos = 2 (content end)
    const mdAfter = pmPosToMdOffset(doc, 2, serialized);
    expect(mdBefore).not.toBe(mdAfter);
    expect(mdBefore).toBeLessThan(mdAfter);
    // Roundtrip
    const newDoc = loadDoc(editor, serialized);
    expect(mdOffsetToPmPos(newDoc, mdBefore, serialized)).toBe(1);
    expect(mdOffsetToPmPos(newDoc, mdAfter, serialized)).toBe(2);
  });
});
