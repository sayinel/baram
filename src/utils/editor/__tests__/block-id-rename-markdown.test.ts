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

  it("keeps CRLF line endings and trailing spaces exactly", () => {
    expect(rename("a ^old  \r\nb\r\n")).toBe("a ^fresh  \r\nb\r\n");
  });

  it("does not touch a longer ID that starts the same way, or one mid-line", () => {
    expect(rename("a ^old2\nb ^old c\n")).toBe("a ^old2\nb ^old c\n");
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

  it("renames a reference that names this file by stem, however it spells the path", () => {
    expect(rename("((note#^old)) ((notes/note#^old)) ((note.md#^old))\n")).toBe(
      "((note#^fresh)) ((notes/note#^fresh)) ((note.md#^fresh))\n",
    );
  });

  it("leaves a reference to another file's block alone, even with the same ID", () => {
    expect(rename("((other#^old)) ((dir/other#^old))\n")).toBe(
      "((other#^old)) ((dir/other#^old))\n",
    );
  });

  it("leaves references to other IDs alone", () => {
    expect(rename("((#^older)) ((#^old-2))\n")).toBe(
      "((#^older)) ((#^old-2))\n",
    );
  });
});

describe("refersToThisDocument", () => {
  it("accepts the empty target and stem matches, percent-escaped too", () => {
    expect(refersToThisDocument("", FILE)).toBe(true);
    expect(refersToThisDocument("note", FILE)).toBe(true);
    expect(refersToThisDocument("Note", FILE)).toBe(false);
    expect(refersToThisDocument("a%29b", "/v/a)b.md")).toBe(true);
  });

  it("rejects another stem", () => {
    expect(refersToThisDocument("other", FILE)).toBe(false);
  });
});
