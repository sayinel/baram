// issue 594 — renaming a block ID in a document that is only text right now
// (a source-mode buffer, a cached openFiles snapshot, a closed tab's file) must
// produce what the editor transaction would have: the definition and this
// document's own references change, nothing else does.
import { describe, expect, it } from "vitest";

import {
  refersToThisDocument,
  renameBlockIdInMarkdown,
} from "../block-id-rename-markdown";

const FILE = "/vault/notes/note.md";
const rename = (md: string): string =>
  renameBlockIdInMarkdown(md, FILE, "old", "fresh");

describe("renameBlockIdInMarkdown — the definition", () => {
  it("renames ` ^old` at the end of a paragraph and of a heading", () => {
    expect(rename("para one ^old\n\n## Title ^old\n")).toBe(
      "para one ^fresh\n\n## Title ^fresh\n",
    );
  });

  it("keeps CRLF line endings", () => {
    expect(rename("a ^old\r\nb\r\n")).toBe("a ^fresh\r\nb\r\n");
  });

  it("leaves an ID followed by trailing spaces alone — the parser does not read it as a block ID", () => {
    expect(rename("a ^old  \n")).toBe("a ^old  \n");
  });

  it("does not touch a longer ID that starts the same way, or one mid-line", () => {
    expect(rename("a ^old2\nb ^old c\n")).toBe("a ^old2\nb ^old c\n");
  });

  it("does not close a fence on a line that carries an info string, and needs the same character", () => {
    // ```md is an opener, never a closer; ~~~ does not close ```.
    const md = "```\nx ^old\n```md\ny ^old\n~~~\nz ^old\n```\nafter ^old\n";
    expect(rename(md)).toBe(
      "```\nx ^old\n```md\ny ^old\n~~~\nz ^old\n```\nafter ^fresh\n",
    );
  });

  it("leaves indented code and inline code spans alone", () => {
    const md =
      "    code ^old\n\tmore ((#^old))\nsee `((#^old))` and ((#^old))\n";
    expect(rename(md)).toBe(
      "    code ^old\n\tmore ((#^old))\nsee `((#^old))` and ((#^fresh))\n",
    );
  });

  it("leaves fenced code alone, whichever fence character and length", () => {
    const md =
      "x ^old\n```\ncode ^old\n((#^old))\n```\ny ^old\n~~~~\nmore ^old\n~~~~\n";
    expect(rename(md)).toBe(
      "x ^fresh\n```\ncode ^old\n((#^old))\n```\ny ^fresh\n~~~~\nmore ^old\n~~~~\n",
    );
  });

  it("is byte-identical when nothing matches", () => {
    const md = "no ids here\n\n((other#^old))\n";
    expect(rename(md)).toBe(md);
  });
});

describe("renameBlockIdInMarkdown — this document's references", () => {
  it("renames self references, with alias and width, and embeds", () => {
    const md =
      "see ((#^old)) and ((#^old|the block)) and ((#^old|the block|w=60))\n\n{{embed ((#^old))}}\n";
    expect(rename(md)).toBe(
      "see ((#^fresh)) and ((#^fresh|the block)) and ((#^fresh|the block|w=60))\n\n{{embed ((#^fresh))}}\n",
    );
  });

  it("renames a reference that names this file, however it spells the path", () => {
    expect(
      rename(
        "((note#^old)) ((Note#^old)) ((notes/note#^old)) ((note.md#^old)) ((./note#^old)) ((../notes/note.markdown#^old))\n",
      ),
    ).toBe(
      "((note#^fresh)) ((Note#^fresh)) ((notes/note#^fresh)) ((note.md#^fresh)) ((./note#^fresh)) ((../notes/note.markdown#^fresh))\n",
    );
  });

  it("leaves a reference to another file's block alone, even with the same ID or stem", () => {
    expect(
      rename(
        "((other#^old)) ((dir/other#^old)) ((elsewhere/note#^old)) ((../note#^old))\n",
      ),
    ).toBe(
      "((other#^old)) ((dir/other#^old)) ((elsewhere/note#^old)) ((../note#^old))\n",
    );
  });

  it("leaves references to other IDs alone", () => {
    expect(rename("((#^older)) ((#^old-2))\n")).toBe(
      "((#^older)) ((#^old-2))\n",
    );
  });
});

describe("refersToThisDocument", () => {
  it("accepts the empty target and case-insensitive stem matches, percent-escaped too", () => {
    expect(refersToThisDocument("", FILE)).toBe(true);
    expect(refersToThisDocument("note", FILE)).toBe(true);
    expect(refersToThisDocument("Note", FILE)).toBe(true);
    expect(refersToThisDocument("note.markdown", FILE)).toBe(true);
    expect(refersToThisDocument("a%29b", "/v/a)b.md")).toBe(true);
  });

  it("resolves relative and path-qualified targets against this file's path", () => {
    expect(refersToThisDocument("./note", FILE)).toBe(true);
    expect(refersToThisDocument("../notes/note", FILE)).toBe(true);
    expect(refersToThisDocument("notes/note", FILE)).toBe(true);
    expect(refersToThisDocument("/vault/notes/note", FILE)).toBe(true);
    expect(refersToThisDocument("../note", FILE)).toBe(false);
    expect(refersToThisDocument("elsewhere/note", FILE)).toBe(false);
  });

  it("rejects another stem", () => {
    expect(refersToThisDocument("other", FILE)).toBe(false);
  });
});
