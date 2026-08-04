// §298 Vim Phase 1 — Korean find-target matching (device R7).

import { describe, expect, it } from "vitest";

import { choseongOf, findTargetMatches } from "../hangul";

describe("choseongOf", () => {
  it("reads the initial consonant of an NFC syllable", () => {
    expect(choseongOf("강")).toBe("ㄱ");
    expect(choseongOf("쌀")).toBe("ㅆ");
    expect(choseongOf("힣")).toBe("ㅎ");
  });

  it("reads NFD conjoining jamo (macOS-style text)", () => {
    expect(choseongOf("\u1100\u1161\u11BC")).toBe("\u3131");
    expect(choseongOf("\u1112\u1175")).toBe("\u314E");
  });

  it("passes a bare compatibility jamo through", () => {
    expect(choseongOf("ㄱ")).toBe("ㄱ");
    expect(choseongOf("ㅆ")).toBe("ㅆ");
  });

  it("is null for anything that is not hangul", () => {
    expect(choseongOf("g")).toBeNull();
    expect(choseongOf("")).toBeNull();
    expect(choseongOf("￼")).toBeNull(); // inline-atom placeholder
    expect(choseongOf("ㅏ")).toBeNull(); // a vowel has no 초성
  });
});

describe("findTargetMatches", () => {
  it("widens a bare consonant jamo to 초성", () => {
    expect(findTargetMatches("강", "ㄱ")).toBe(true);
    expect(findTargetMatches("김", "ㄱ")).toBe(true);
    expect(findTargetMatches("나", "ㄱ")).toBe(false);
    expect(findTargetMatches("g", "ㄱ")).toBe(false);
  });

  it("keeps a full syllable EXACT — f강 must not land on 김", () => {
    expect(findTargetMatches("강", "강")).toBe(true);
    expect(findTargetMatches("김", "강")).toBe(false);
  });

  it("matches across NFC/NFD forms literally", () => {
    expect(findTargetMatches("\u1100\u1161\u11BC", "\uac15")).toBe(true);
    expect(findTargetMatches("\uac15", "\u1100\u1161\u11BC")).toBe(true);
  });

  it("a vowel jamo stays literal (no widening)", () => {
    expect(findTargetMatches("아", "ㅏ")).toBe(false);
    expect(findTargetMatches("ㅏ", "ㅏ")).toBe(true);
  });

  it("plain latin stays plain", () => {
    expect(findTargetMatches("x", "x")).toBe(true);
    expect(findTargetMatches("x", "y")).toBe(false);
  });
});
