import { describe, expect, it } from "vitest";

import { AI_PROVIDER_IDS, AI_PROVIDERS } from "../../stores/ai/providers";
import { isLLMAllowed } from "../privacy-check";

describe("isLLMAllowed", () => {
  it("allows all providers when privacy is off", () => {
    expect(isLLMAllowed(true, false, "claude")).toBe(true);
    expect(isLLMAllowed(true, false, "openai")).toBe(true);
    expect(isLLMAllowed(true, false, "ollama")).toBe(true);
  });

  it("blocks cloud providers when global privacy is on", () => {
    expect(isLLMAllowed(true, true, "claude")).toBe(false);
    expect(isLLMAllowed(true, true, "openai")).toBe(false);
    expect(isLLMAllowed(true, true, "gemini")).toBe(false);
  });

  it("allows ollama when global privacy is on", () => {
    expect(isLLMAllowed(true, true, "ollama")).toBe(true);
  });

  it("blocks cloud providers when filePrivacy is true", () => {
    expect(isLLMAllowed(true, false, "claude", true)).toBe(false);
    expect(isLLMAllowed(true, false, "openai", true)).toBe(false);
  });

  it("allows ollama when filePrivacy is true", () => {
    expect(isLLMAllowed(true, false, "ollama", true)).toBe(true);
  });

  it.each(AI_PROVIDER_IDS)(
    "under privacy mode allows %s only if it runs locally",
    (provider) => {
      // Derived from the provider table instead of a hand-written list, which
      // is what stops the next cloud provider from being added and simply not
      // appearing in this file. The equivalence asserted here is
      // "keyless == local": true of Ollama, and the reason a future provider
      // that needs no key but does leave the machine must break this test
      // rather than inherit an allowance.
      expect(isLLMAllowed(true, true, provider)).toBe(
        AI_PROVIDERS[provider].keyless,
      );
    },
  );

  it("uses global privacy when filePrivacy is false", () => {
    expect(isLLMAllowed(true, false, "claude", false)).toBe(true);
    expect(isLLMAllowed(true, true, "claude", false)).toBe(false);
  });

  // §339 — the AI kill switch. `aiEnabled === false` is always `false`,
  // independent of privacy mode, file privacy, or provider: it must not be
  // possible to route around it via a local/keyless provider like ollama —
  // "off" means off, not "local only".
  describe("aiEnabled kill switch", () => {
    it("blocks every provider when aiEnabled is false, privacy off", () => {
      expect(isLLMAllowed(false, false, "claude")).toBe(false);
      expect(isLLMAllowed(false, false, "openai")).toBe(false);
      expect(isLLMAllowed(false, false, "ollama")).toBe(false);
    });

    it("blocks ollama too when aiEnabled is false, even under privacy mode", () => {
      expect(isLLMAllowed(false, true, "ollama")).toBe(false);
    });

    it("blocks ollama when aiEnabled is false, even with filePrivacy true", () => {
      expect(isLLMAllowed(false, false, "ollama", true)).toBe(false);
    });

    it.each(AI_PROVIDER_IDS)(
      "blocks %s when aiEnabled is false regardless of privacy state",
      (provider) => {
        expect(isLLMAllowed(false, false, provider)).toBe(false);
        expect(isLLMAllowed(false, true, provider)).toBe(false);
      },
    );
  });
});
