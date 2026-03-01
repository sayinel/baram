// §56m Tag Node tests — regex + serialization
import { describe, it, expect } from "vitest";
import { serializeTag, TAG_NODE_RE } from "../../pipeline/transformers/tag-transformer";

describe("Tag Node", () => {
  describe("TAG_NODE_RE", () => {
    it("matches simple tag", () => {
      const text = "Hello #world tag";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("world");
    });

    it("matches tag at start of string", () => {
      const text = "#project is great";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("project");
    });

    it("matches nested tag with slash", () => {
      const text = "#project/baram is great";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("project/baram");
    });

    it("matches Korean tag", () => {
      const text = "오늘 #일기 쓰기";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("일기");
    });

    it("matches multiple tags", () => {
      const text = "#hello and #world";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe("hello");
      expect(matches[1][1]).toBe("world");
    });

    it("does not match heading (space after #)", () => {
      // "# Heading" has space after #, not word char
      const text = "# Heading text";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(0);
    });

    it("does not match mid-word hash", () => {
      // "abc#def" — # is not at start or after whitespace
      const text = "abc#def";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(0);
    });
  });

  describe("serializeTag", () => {
    it("serializes simple tag", () => {
      expect(serializeTag({ tag: "world" })).toBe("#world");
    });

    it("serializes nested tag", () => {
      expect(serializeTag({ tag: "project/baram" })).toBe("#project/baram");
    });

    it("serializes Korean tag", () => {
      expect(serializeTag({ tag: "일기" })).toBe("#일기");
    });
  });
});
