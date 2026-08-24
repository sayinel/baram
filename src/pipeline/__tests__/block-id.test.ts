// §30a Block ID utility tests + §30b Block Reference/Embed utility tests
import { describe, expect, it } from "vitest";

import {
  appendBlockId,
  BLOCK_EMBED_RE,
  BLOCK_ID_SUFFIX_RE,
  BLOCK_REF_RE,
  extractBlockId,
  generateBlockId,
  parseBlockEmbedMatch,
  parseBlockRefMatch,
  parseRefWidth,
  serializeBlockEmbed,
  serializeBlockRef,
  splitRefWidth,
} from "../block-id";

describe("extractBlockId", () => {
  it("extracts simple alphanumeric ID", () => {
    const result = extractBlockId("some text ^abc123");
    expect(result).toEqual({ blockId: "abc123", strippedText: "some text" });
  });

  it("extracts ID with hyphens", () => {
    const result = extractBlockId("text ^my-block-id");
    expect(result).toEqual({ blockId: "my-block-id", strippedText: "text" });
  });

  it("extracts ID with underscores", () => {
    const result = extractBlockId("text ^block_id_1");
    expect(result).toEqual({ blockId: "block_id_1", strippedText: "text" });
  });

  it("returns null for text without block ID", () => {
    expect(extractBlockId("just plain text")).toBeNull();
  });

  it("returns null for caret without space before it (e.g. x^2)", () => {
    expect(extractBlockId("x^2")).toBeNull();
  });

  it("returns null for caret in middle of text", () => {
    expect(extractBlockId("some ^mid text")).toBeNull();
  });

  it("returns null for empty string after caret", () => {
    expect(extractBlockId("text ^")).toBeNull();
  });

  it("returns null for ID starting with non-alphanumeric", () => {
    expect(extractBlockId("text ^-invalid")).toBeNull();
    expect(extractBlockId("text ^_invalid")).toBeNull();
  });

  it("handles single-char ID", () => {
    const result = extractBlockId("text ^a");
    expect(result).toEqual({ blockId: "a", strippedText: "text" });
  });
});

describe("appendBlockId", () => {
  it("appends block ID with space+caret", () => {
    expect(appendBlockId("text", "abc123")).toBe("text ^abc123");
  });

  it("appends to empty string", () => {
    expect(appendBlockId("", "id1")).toBe(" ^id1");
  });
});

describe("BLOCK_ID_SUFFIX_RE", () => {
  it("matches valid block ID at end of string", () => {
    expect(BLOCK_ID_SUFFIX_RE.test("text ^a3f2b1c8")).toBe(true);
  });

  it("does not match without leading space", () => {
    expect(BLOCK_ID_SUFFIX_RE.test("text^abc")).toBe(false);
  });

  it("does not match math notation like x^2", () => {
    expect(BLOCK_ID_SUFFIX_RE.test("x^2")).toBe(false);
  });
});

// --- §30b tests ---

describe("generateBlockId", () => {
  it("returns 8-character hex string", () => {
    const id = generateBlockId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBlockId()));
    expect(ids.size).toBe(100);
  });
});

describe("BLOCK_REF_RE", () => {
  it("matches ((target#^id))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((architecture#^a3f2b1c8))");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("architecture");
    expect(match![2]).toBe("a3f2b1c8");
    expect(match![3]).toBeUndefined();
  });

  it("matches ((target#^id|display))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((architecture#^a3f2b1c8|핵심 원칙))");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("architecture");
    expect(match![2]).toBe("a3f2b1c8");
    expect(match![3]).toBe("핵심 원칙");
  });

  it("matches ((#^id)) — same file", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((#^a3f2b1c8))");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("");
    expect(match![2]).toBe("a3f2b1c8");
  });

  it("does not match ((no-hash))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    expect(re.exec("((no-hash))")).toBeNull();
  });

  it("does not match ((target#no-caret))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    expect(re.exec("((target#no-caret))")).toBeNull();
  });
});

describe("parseBlockRefMatch", () => {
  it("parses target, blockId, display", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((file#^abc123|text))")!;
    const result = parseBlockRefMatch(match);
    expect(result).toEqual({
      target: "file",
      blockId: "abc123",
      display: "text",
      width: null,
    });
  });

  it("parses without display", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((file#^abc123))")!;
    const result = parseBlockRefMatch(match);
    expect(result).toEqual({
      target: "file",
      blockId: "abc123",
      display: null,
      width: null,
    });
  });

  // §276.6 — the width lives inside the display capture, so these pin that
  // parseBlockRefMatch actually delegates the split instead of handing the
  // raw capture straight through as display text.
  it("parses display and trailing |w=NN width", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((file#^abc123|text|w=60))")!;
    expect(parseBlockRefMatch(match)).toEqual({
      target: "file",
      blockId: "abc123",
      display: "text",
      width: 60,
    });
  });

  it("parses a width-only reference as null display", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((file#^abc123|w=60))")!;
    expect(parseBlockRefMatch(match)).toEqual({
      target: "file",
      blockId: "abc123",
      display: null,
      width: 60,
    });
  });
});

// §276.6 — the pure split, tested directly at every boundary. The range check
// here is the only thing separating a width field from display text that
// happens to read `w=…`; markdown round-trip cannot see the difference
// (both re-serialize byte-identically), so it has to be asserted here.
describe("splitRefWidth", () => {
  it("splits a trailing |w=NN off the display text", () => {
    expect(splitRefWidth("text|w=60")).toEqual({ display: "text", width: 60 });
  });

  it("treats a bare w=NN display as width-only", () => {
    expect(splitRefWidth("w=60")).toEqual({ display: null, width: 60 });
  });

  it("leaves a display with no width untouched", () => {
    expect(splitRefWidth("핵심 원칙")).toEqual({
      display: "핵심 원칙",
      width: null,
    });
  });

  it("splits only at the LAST pipe", () => {
    expect(splitRefWidth("a|b|w=75")).toEqual({ display: "a|b", width: 75 });
  });

  it("keeps w=5 (below the 10 minimum) as display text", () => {
    expect(splitRefWidth("w=5")).toEqual({ display: "w=5", width: null });
  });

  it("keeps w=200 (above the 100 maximum) as display text", () => {
    expect(splitRefWidth("w=200")).toEqual({ display: "w=200", width: null });
  });

  it("accepts the 10 and 100 boundaries themselves", () => {
    expect(splitRefWidth("w=10")).toEqual({ display: null, width: 10 });
    expect(splitRefWidth("w=100")).toEqual({ display: null, width: 100 });
  });

  it("keeps a non-integer w=60.5 as display text", () => {
    expect(splitRefWidth("w=60.5")).toEqual({
      display: "w=60.5",
      width: null,
    });
  });

  it("keeps a non-numeric w=abc as display text", () => {
    expect(splitRefWidth("w=abc")).toEqual({ display: "w=abc", width: null });
  });

  it("keeps a leading-zero w=060 as display text (it would not re-serialize)", () => {
    expect(splitRefWidth("w=060")).toEqual({ display: "w=060", width: null });
  });

  it("does not split when the display before the pipe is empty", () => {
    // `((a#^id||w=60))` — splitting would drop the first pipe on the way out.
    expect(splitRefWidth("|w=60")).toEqual({ display: "|w=60", width: null });
  });

  it("keeps a trailing pipe with no field as display text", () => {
    expect(splitRefWidth("text|")).toEqual({ display: "text|", width: null });
  });
});

describe("parseRefWidth", () => {
  it("accepts integers in 10..100", () => {
    expect(parseRefWidth("10")).toBe(10);
    expect(parseRefWidth("60")).toBe(60);
    expect(parseRefWidth("100")).toBe(100);
  });

  it("rejects out-of-range, malformed, and empty values", () => {
    expect(parseRefWidth("9")).toBeNull();
    expect(parseRefWidth("101")).toBeNull();
    expect(parseRefWidth("60.5")).toBeNull();
    expect(parseRefWidth("abc")).toBeNull();
    expect(parseRefWidth("060")).toBeNull();
    expect(parseRefWidth("")).toBeNull();
    expect(parseRefWidth(null)).toBeNull();
  });
});

describe("serializeBlockRef", () => {
  it("serializes with target and blockId", () => {
    expect(serializeBlockRef({ target: "file", blockId: "abc123" })).toBe(
      "((file#^abc123))",
    );
  });

  it("serializes with display text", () => {
    expect(
      serializeBlockRef({ target: "file", blockId: "abc123", display: "text" }),
    ).toBe("((file#^abc123|text))");
  });

  it("serializes same-file reference", () => {
    expect(serializeBlockRef({ target: "", blockId: "abc123" })).toBe(
      "((#^abc123))",
    );
  });

  // §276.6
  it("serializes display + width", () => {
    expect(
      serializeBlockRef({
        target: "file",
        blockId: "abc123",
        display: "text",
        width: 60,
      }),
    ).toBe("((file#^abc123|text|w=60))");
  });

  it("serializes width without display as ((target#^id|w=NN))", () => {
    expect(
      serializeBlockRef({ target: "file", blockId: "abc123", width: 60 }),
    ).toBe("((file#^abc123|w=60))");
  });

  it("omits the width field when width is null", () => {
    expect(
      serializeBlockRef({
        target: "file",
        blockId: "abc123",
        display: "text",
        width: null,
      }),
    ).toBe("((file#^abc123|text))");
  });

  it("treats only null as absent — 0 is a number, and is written out", () => {
    // ‼️ 진공 상태의 단정이 아니다. 진입점(parseRefWidth / clampSnapPct)이
    // 전부 검증하므로 0은 오늘 도달하지 못하지만, 진리값 검사(`attrs.width ?`)는
    // 0을 **조용히 없는 값으로** 만들어 필드를 통째로 버린다. 여기서는 써 내고,
    // 읽을 때 parseRefWidth가 `w=0`을 거부해 display 텍스트로 남긴다 — 즉
    // 왕복은 여전히 바이트 동일하고, 데이터는 사라지지 않는다.
    expect(
      serializeBlockRef({ target: "file", blockId: "abc123", width: 0 }),
    ).toBe("((file#^abc123|w=0))");
  });

  // The two functions are each other's inverse — this is what keeps the
  // markdown on disk byte-identical across a load/save cycle.
  it("round-trips serialize → match → parse with a width", () => {
    const attrs = {
      target: "file",
      blockId: "abc123",
      display: "text",
      width: 60,
    };
    const match = new RegExp(BLOCK_REF_RE.source, "g").exec(
      serializeBlockRef(attrs),
    )!;
    expect(parseBlockRefMatch(match)).toEqual(attrs);
  });
});

describe("BLOCK_EMBED_RE", () => {
  it("matches {{embed ((target#^id))}}", () => {
    const match = BLOCK_EMBED_RE.exec("{{embed ((architecture#^a3f2b1c8))}}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("architecture");
    expect(match![2]).toBe("a3f2b1c8");
  });

  it("matches same-file embed", () => {
    const match = BLOCK_EMBED_RE.exec("{{embed ((#^a3f2b1c8))}}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("");
    expect(match![2]).toBe("a3f2b1c8");
  });

  it("does not match if text before", () => {
    expect(BLOCK_EMBED_RE.exec("text {{embed ((file#^id))}}")).toBeNull();
  });

  it("does not match if text after", () => {
    expect(BLOCK_EMBED_RE.exec("{{embed ((file#^id))}} text")).toBeNull();
  });
});

describe("parseBlockEmbedMatch", () => {
  it("parses target and blockId", () => {
    const match = BLOCK_EMBED_RE.exec("{{embed ((file#^abc123))}}")!;
    const result = parseBlockEmbedMatch(match);
    expect(result).toEqual({ target: "file", blockId: "abc123" });
  });
});

describe("serializeBlockEmbed", () => {
  it("serializes embed text", () => {
    expect(serializeBlockEmbed({ target: "file", blockId: "abc123" })).toBe(
      "{{embed ((file#^abc123))}}",
    );
  });

  it("serializes same-file embed", () => {
    expect(serializeBlockEmbed({ target: "", blockId: "abc123" })).toBe(
      "{{embed ((#^abc123))}}",
    );
  });
});
