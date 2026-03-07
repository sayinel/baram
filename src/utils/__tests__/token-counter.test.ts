import { estimateTokenCount, formatTokenCount } from "../token-counter";

describe("estimateTokenCount", () => {
  it("estimates English text (~4 chars per token)", () => {
    const text = "Hello world this is a test";
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(10);
  });

  it("estimates Korean text (more tokens per char)", () => {
    const text = "안녕하세요 테스트입니다";
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(5);
  });

  it("returns 0 for empty", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("handles mixed content", () => {
    const text = "<system>\nYou are a 도우미\n</system>";
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(5);
  });
});

describe("formatTokenCount", () => {
  it("formats small numbers", () => {
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(2500)).toBe("2.5k");
    expect(formatTokenCount(12345)).toBe("12.3k");
  });
});
