import { describe, expect, it } from "vitest";

import { isLLMAllowed } from "../privacy-check";

describe("isLLMAllowed", () => {
  it("allows all providers when privacy is off", () => {
    expect(isLLMAllowed(false, "claude")).toBe(true);
    expect(isLLMAllowed(false, "openai")).toBe(true);
    expect(isLLMAllowed(false, "ollama")).toBe(true);
  });

  it("blocks cloud providers when global privacy is on", () => {
    expect(isLLMAllowed(true, "claude")).toBe(false);
    expect(isLLMAllowed(true, "openai")).toBe(false);
    expect(isLLMAllowed(true, "gemini")).toBe(false);
  });

  it("allows ollama when global privacy is on", () => {
    expect(isLLMAllowed(true, "ollama")).toBe(true);
  });

  it("blocks cloud providers when filePrivacy is true", () => {
    expect(isLLMAllowed(false, "claude", true)).toBe(false);
    expect(isLLMAllowed(false, "openai", true)).toBe(false);
  });

  it("allows ollama when filePrivacy is true", () => {
    expect(isLLMAllowed(false, "ollama", true)).toBe(true);
  });

  it("uses global privacy when filePrivacy is false", () => {
    expect(isLLMAllowed(false, "claude", false)).toBe(true);
    expect(isLLMAllowed(true, "claude", false)).toBe(false);
  });
});
